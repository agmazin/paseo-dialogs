import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

const home = process.env.PASEO_TEST_HOME;
assert.ok(home && home.includes('agm15-autotitle-home'), 'Requires the disposable AGM15 home');
const pid = JSON.parse(await readFile(join(home, 'paseo.pid'), 'utf8'));
assert.equal(pid.listen, '127.0.0.1:6794');
const fixture = join(home, 'fixture-plugin');
await mkdir(fixture, { recursive: true });
for (const name of ['server', 'shared', 'client', 'index.server.ts', 'index.client.tsx', 'paseo-plugin.json', 'package.json', 'OVERVIEW.md'])
  await cp(resolve(name), join(fixture, name), { recursive: true });
await symlink(resolve('node_modules'), join(fixture, 'node_modules')).catch(error => { if (error.code !== 'EEXIST') throw error; });
const credentialsPath = '/Users/agmazin/Yandex.Disk.localized/public/projects/agmazin/.secrets/cliproxy.env';
const env: Record<string, string> = {};
for (const line of (await readFile(credentialsPath, 'utf8')).split(/\r?\n/)) {
  const match = line.match(/^\s*(CLIPROXY_(?:KEY|URL)_MAC)\s*=\s*(.+?)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '').split(/\s+#/)[0];
}
const testCredentials = join(home, 'fixture.env');
await writeFile(testCredentials, 'CLIPROXY_URL_MAC=http://127.0.0.1:6795\nCLIPROXY_KEY_MAC=fixture', { mode: 0o600 });
const runtime = join(fixture, 'server/runtime.ts');
await writeFile(runtime, (await readFile(runtime, 'utf8')).replace(credentialsPath, testCredentials));
const createClient = () => new DaemonClient({ url: `ws://${pid.listen}/ws`, clientId: 'agm15-integration', clientType: 'cli',
  localCredential: async () => (await readFile(join(home, 'local-credential'), 'utf8')).trim() });
let client = createClient();
let failures: string[] = [];
let duringRequest: (() => Promise<void>) | undefined;
let requests = 0;
const proxy = createServer(async (request, response) => {
  try {
    requests++;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    assert.equal(JSON.parse(body.toString()).max_tokens, 256);
    await duringRequest?.();
    const failure = failures.shift();
    response.setHeader('Content-Type', 'application/json');
    if (failure === 'generation') { response.writeHead(503); response.end('{}'); return; }
    if (failure === 'validation') { response.end(JSON.stringify({ choices: [{ message: { content: '' } }] })); return; }
    const upstream = await fetch(`${env.CLIPROXY_URL_MAC.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.CLIPROXY_KEY_MAC}`, 'Content-Type': 'application/json' },
      body, signal: AbortSignal.timeout(20000),
    });
    response.writeHead(upstream.status);
    response.end(await upstream.text());
  } catch { response.writeHead(502); response.end('{}'); }
});
const results: Record<string, unknown> = {};
try {
  await new Promise<void>(ready => proxy.listen(6795, '127.0.0.1', ready));
  await promisify(execFile)('/opt/homebrew/bin/paseo', ['plugin', 'remove', 'paseo-dialogs', '--home', home, '--json']);
  await promisify(execFile)('/opt/homebrew/bin/paseo', ['plugin', 'install', fixture, '--home', home, '--json']);
  await client.connect();
  const cwd = join(home, 'fixtures');
  await mkdir(cwd, { recursive: true });
  const workspace = await client.createWorkspace({ source: { kind: 'directory', path: cwd }, title: 'Autotitle regression fixtures' });
  for (const scenario of ['retry', 'manual-race', 'bounded']) {
    const before = requests;
    failures = scenario === 'retry' ? ['generation', 'validation'] : scenario === 'bounded' ? ['generation', 'generation', 'generation'] : [];
    const agent = await client.createAgent({ provider: 'codex', model: 'gpt-6-luna', workspaceId: workspace.workspace.id, cwd,
      modeId: 'full-access', labels: { 'agm15.fixture': 'true', 'kanban.key': 'TST-15' } });
    duringRequest = scenario === 'manual-race' ? async () => { await client.updateAgent(agent.id, { name: 'TST-15: Ручное название' }); } : undefined;
    await client.sendMessage(agent.id, 'Обсудим полив цветов. Ответь одним словом: Хорошо. Инструменты не используй.');
    await client.waitForFinish(agent.id, 60000);
    let candidate;
    for (let i = 0; i < 100; i++) {
      const state = JSON.parse(await readFile(join(home, 'plugin-data/paseo-dialogs/state.json'), 'utf8'));
      candidate = state.candidates[agent.id];
      if (!candidate || (scenario === 'bounded' && candidate.attempts === 3)) break;
      await new Promise(ready => setTimeout(ready, 500));
    }
    if (scenario === 'bounded') await new Promise(ready => setTimeout(ready, 2000));
    const snapshot = await client.fetchAgent(agent.id);
    assert.ok(snapshot);
    if (scenario === 'retry') {
      assert.equal(requests - before, 3);
      assert.equal(candidate, undefined);
      assert.match(snapshot.agent.title!, /^TST-15: [А-ЯЁ]/);
    }
    if (scenario === 'manual-race') assert.equal(snapshot.agent.title, 'TST-15: Ручное название');
    if (scenario === 'bounded') { assert.equal(requests - before, 3); assert.equal(candidate.attempts, 3); }
    results[scenario] = { id: agent.id, title: snapshot.agent.title, requests: requests - before, candidate };
  }
  const beforeReconnect = requests;
  const logs = await promisify(execFile)('/opt/homebrew/bin/paseo', ['plugin', 'logs', 'paseo-dialogs', '--home', home, '--json']);
  await writeFile(resolve('.qa/agm15-integration-logs.json'), logs.stdout);
  await promisify(execFile)('/opt/homebrew/bin/paseo', ['plugin', 'reload', 'paseo-dialogs', '--home', home, '--json']);
  await client.close();
  client = createClient();
  await client.connect();
  await client.invokePluginRpc('paseo-dialogs', 'dialogs.state', {});
  await new Promise(ready => setTimeout(ready, 1500));
  for (const result of Object.values(results) as { id: string; title: string }[]) {
    assert.equal((await client.fetchAgent(result.id))?.agent.title, result.title);
  }
  assert.equal(requests, beforeReconnect);
  results.reconnect = { pluginReload: true, clientReconnected: true, titlesUnchanged: true, extraRequests: 0 };
  await writeFile(resolve('.qa/agm15-integration-result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await client.close();
  await promisify(execFile)('/opt/homebrew/bin/paseo', ['plugin', 'remove', 'paseo-dialogs', '--home', home, '--json']);
  await promisify(execFile)('/opt/homebrew/bin/paseo', ['plugin', 'install', resolve('.'), '--home', home, '--json']);
  proxy.closeAllConnections();
  await new Promise<void>(done => proxy.close(() => done()));
}
