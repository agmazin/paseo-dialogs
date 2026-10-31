import assert from 'node:assert/strict';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

const home = process.env.PASEO_TEST_HOME;
assert.ok(home, 'PASEO_TEST_HOME must explicitly identify the daemon');
const root = resolve('.qa/self-title-live');
const plugin = join(root, 'plugin');
const cwd = '/private/tmp/paseo-self-title-agm24-fixture';
const production = process.env.PASEO_TEST_PRODUCTION === '1';
const pluginId = production ? 'paseo-dialogs' : 'paseo-dialogs-self-title-fixture';
await mkdir(plugin, { recursive: true });
await mkdir(cwd, { recursive: true });
if (!production) {
for (const name of ['server', 'shared', 'package.json', 'OVERVIEW.md'])
  await cp(resolve(name), join(plugin, name), { recursive: true });
await symlink(resolve('node_modules'), join(plugin, 'node_modules')).catch(error => { if (error.code !== 'EEXIST') throw error; });
await writeFile(join(plugin, 'paseo-plugin.json'), JSON.stringify({ id: pluginId, name: 'Self-title disposable fixture', version: '0.11.0', requirements: { paseo: '>=0.13.2' } }));
await writeFile(join(plugin, 'index.server.ts'), `import { registerSelfTitle } from './server/self-title';\nexport default function contribute(server) { return registerSelfTitle(server, ${JSON.stringify({ pluginId, cwd })}); }\n`);
}
const cli = (...args: string[]) => promisify(execFile)('/opt/homebrew/bin/paseo', [...args, '--home', home, '--json'], { timeout: 30000 });
const pid = JSON.parse(await readFile(join(home, 'paseo.pid'), 'utf8'));
assert.equal(pid.listen, '127.0.0.1:6767', 'This verification targets the actual 0.13.2 daemon');
const connect = () => new DaemonClient({ url: `ws://${pid.listen}/ws`, clientId: 'agm24-self-title-fixture', clientType: 'cli',
  localCredential: async () => (await readFile(join(home, 'local-credential'), 'utf8')).trim() });
let client = connect();
const ids: string[] = [];
let workspaceId: string | undefined;
const result: any = { daemonPid: pid.pid, listen: pid.listen, cases: [] };
try {
  if (!production) await cli('plugin', 'install', plugin);
  else {
    const config = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(config.plugins[pluginId].path, 'paseo-plugin.json'), 'utf8'));
    assert.equal(manifest.version, '0.11.0', 'Production verification requires the deployed release');
  }
  await client.connect();
  result.daemonStatus = await client.getDaemonStatus();
  const workspace = await client.createWorkspace({ source: { kind: 'directory', path: cwd }, title: 'Disposable self-title fixture AGM24' });
  workspaceId = workspace.workspace.id;
  for (const scenario of ['plain', 'manual', 'numbered']) {
    const agent = await client.createAgent({ config: {
      provider: 'codex', model: 'gpt-6.1-sol', modeId: scenario === 'plain' ? 'auto-review' : 'full-access', cwd,
      ...(scenario === 'manual' ? { title: 'Ручное имя' } : {}),
      systemPrompt: 'Для основной задачи ответь одним словом: Хорошо. Если нужны служебные действия, выполни их перед ответом.',
    }, workspaceId, cwd, labels: { 'agm24.fixture': 'true', ...(scenario === 'numbered' ? { 'kanban.key': 'TST-24' } : {}) } });
    ids.push(agent.id);
    await client.sendMessage(agent.id, 'Помоги настроить полив домашних цветов.');
    const finished = await client.waitForFinish(agent.id, 60000);
    const timeline = await client.fetchAgentTimeline(agent.id, { direction: 'before', limit: 100 });
    await writeFile(join(root, `${scenario}-timeline.json`), JSON.stringify(timeline, null, 2));
    const tools = timeline.entries.filter(entry => entry.item.type === 'tool_call');
    assert.ok(tools.length > 0, `${scenario}: no first tool call`);
    assert.match(JSON.stringify(tools[0].item), /name_this_chat/, `${scenario}: naming was not the first tool`);
    const firstAction = timeline.entries.find(entry => ['tool_call', 'assistant_message'].includes(entry.item.type));
    assert.equal(firstAction?.item.type, 'tool_call', 'Naming must precede assistant output');
    const snapshot = await client.fetchAgent(agent.id);
    assert.ok(snapshot);
    assert.equal(snapshot.agent.archivedAt, null);
    const body = snapshot.agent.title!.replace(/^[A-Z]{3}-\d+(?:-\d+)*: /, '');
    if (scenario === 'manual') assert.equal(body, 'Ручное имя');
    else assert.match(body, /^[А-ЯЁ]/);
    if (snapshot.agent.labels['kanban.key']) assert.ok(snapshot.agent.title!.startsWith(snapshot.agent.labels['kanban.key'] + ': '));
    result.cases.push({ scenario, id: agent.id, title: snapshot.agent.title, firstTool: tools[0].item, finished });
  }
  const beforeReload = JSON.parse(await readFile(join(home, 'plugin-data', pluginId, 'self-titles.json'), 'utf8'));
  await cli('plugin', 'reload', pluginId);
  await client.close(); client = connect(); await client.connect();
  const reconnect = await client.createAgent({ config: { provider: 'codex', model: 'gpt-6.1-sol', cwd, modeId: 'full-access' }, cwd, workspaceId,
    labels: { 'agm24.fixture': 'true' } });
  ids.push(reconnect.id);
  // Saved naming configuration survives a plugin reload before the first message.
  await cli('plugin', 'reload', pluginId);
  await client.sendMessage(reconnect.id, 'Помоги настроить полив домашних цветов. Ответь одним словом.');
  await client.waitForFinish(reconnect.id, 60000);
  const reconnectTimeline = await client.fetchAgentTimeline(reconnect.id, { direction: 'before', limit: 100 });
  await writeFile(join(root, 'reconnect-timeline.json'), JSON.stringify(reconnectTimeline, null, 2));
  assert.match(JSON.stringify(reconnectTimeline.entries.find(entry => entry.item.type === 'tool_call')?.item), /name_this_chat/);
  for (const entry of result.cases) assert.equal((await client.fetchAgent(entry.id))?.agent.title, entry.title);
  const afterReload = JSON.parse(await readFile(join(home, 'plugin-data', pluginId, 'self-titles.json'), 'utf8'));
  for (const id of ids) if (beforeReload[id]) assert.deepEqual(afterReload[id], beforeReload[id]);
  const reconnectName = (await client.fetchAgent(reconnect.id))!.agent.title;
  await client.refreshAgent(reconnect.id);
  await client.sendMessage(reconnect.id, 'Теперь обсудим приготовление супа. Ответь одним словом.');
  await client.waitForFinish(reconnect.id, 60000);
  assert.equal((await client.fetchAgent(reconnect.id))?.agent.title, reconnectName);
  result.reconnect = { id: reconnect.id, title: reconnectName, previousNamesUnchanged: true, providerReloadAfterFirstTurn: true };
  await Promise.all([client.updateAgent(reconnect.id, { name: reconnectName! }), client.archiveAgent(reconnect.id)]);
  assert.ok((await client.fetchAgent(reconnect.id))?.agent.archivedAt);
  const scope = afterReload[reconnect.id];
  await client.invokePluginRpc(pluginId, 'dialogs.self-title', { token: scope.token, title: 'Проверка архива' });
  assert.ok((await client.fetchAgent(reconnect.id))?.agent.archivedAt);
  await assert.rejects(client.invokePluginRpc(pluginId, 'dialogs.self-title', { token: scope.token, title: 'Чужой чат', agentId: ids[0] }));
  result.archiveRace = { retained: true, extraAgentIdRejected: true };
  await writeFile(join(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const id of ids) await client.archiveAgent(id).catch(() => {});
  if (workspaceId) await client.archiveWorkspace(workspaceId).catch(() => {});
  await client.close();
  if (!production) await cli('plugin', 'remove', pluginId);
}
