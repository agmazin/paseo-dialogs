import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

test('created hook persists candidates; completed hook titles once, preserves manual edits and Kanban races', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dialogs-title-'));
  const previousHome = process.env.PASEO_HOME;
  const previousFetch = globalThis.fetch;
  process.env.PASEO_HOME = home;
  const require = createRequire(import.meta.url);
  const cache = new Map<string, any>();
  const updates: string[][] = [];
  let requests = 0;
  let duringGeneration = () => {};
  globalThis.fetch = async () => {
    requests++;
    duringGeneration();
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Проверка заявок' } }] }) } as Response;
  };
  function load(file: string): any {
    if (cache.has(file)) return cache.get(file);
    const exports: any = {};
    cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    new Function('exports', 'require', code)(exports, (id: string) => id === '@getpaseo/plugin'
      ? { defineRpc: (value: any) => value } : id.startsWith('.')
      ? load(resolve(dirname(file), id + '.ts')) : id === 'node:fs/promises'
      ? { ...require(id), readFile: async (path: string, ...args: any[]) => path.endsWith('/cliproxy.env')
        ? 'CLIPROXY_URL_MAC=http://fixture.invalid\nCLIPROXY_KEY_MAC=fixture' : require(id).readFile(path, ...args) }
      : id === 'node:child_process' ? { execFile: (_: string, args: string[], _options: any, callback: any) => {
        updates.push(args); callback(null, '', '');
      } } : require(id));
    return exports;
  }
  let stop: (() => Promise<void>) | undefined;
  try {
    const events = new Map<string, any>();
    stop = load(resolve('server/runtime.ts')).register({ handle() {}, on(name: string, fn: any) {
      events.set(name, fn); return () => {};
    } });
    const prompt = 'Проверь заявки';
    let current: any;
    const paseo = {
      workspaces: { ref: () => ({ refresh: async () => ({ id: 'w' }) }) },
      agents: { ref: () => ({ refresh: async () => ({ agent: structuredClone(current) }), timeline: {
        append: async () => {}, refetch: async () => ({ entries: [{ item: { type: 'user_message', text: prompt } }] }),
      } }) },
    };
    for (const scenario of ['plain', 'prefix', 'prefix-race', 'manual', 'manual-race']) {
      current = { id: scenario, workspaceId: 'w', title: scenario === 'manual' ? 'Ручное название' : prompt };
      await events.get('agent.created')({ agent: structuredClone(current) }, { paseo });
      const saved = JSON.parse(await readFile(join(home, 'plugin-data/paseo-dialogs/state.json'), 'utf8'));
      assert.ok(saved.candidates[scenario]);
      if (scenario === 'prefix') Object.assign(current, { title: `AGM-11: ${prompt}`, labels: { 'kanban.key': 'AGM-11' } });
      duringGeneration = () => {
        if (scenario === 'prefix-race') Object.assign(current, { title: `AGM-11: ${prompt}`, labels: { 'kanban.key': 'AGM-11' } });
        if (scenario === 'manual-race') current.title = 'Название человека';
      };
      const count = updates.length;
      await events.get('agent.turn_ended')({ agent: current, outcome: { kind: 'completed' } }, { paseo });
      const expected = scenario.startsWith('manual') ? 0 : 1;
      assert.equal(updates.length - count, expected, scenario);
      if (expected) assert.equal(updates.at(-1)![updates.at(-1)!.indexOf('--name') + 1], scenario === 'plain' ? 'Проверка заявок' : 'AGM-11: Проверка заявок');
      await events.get('agent.turn_ended')({ agent: current, outcome: { kind: 'completed' } }, { paseo });
      assert.equal(updates.length - count, expected, 'one attempt only');
    }
    assert.equal(requests, 4);
  } finally {
    await stop?.();
    globalThis.fetch = previousFetch;
    if (previousHome === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
