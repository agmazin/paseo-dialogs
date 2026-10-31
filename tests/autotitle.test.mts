import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';

test('same-agent naming: creation, scope, manual names, retries, archive and reconnect', async t => {
  const home = await mkdtemp(join(tmpdir(), 'dialogs-self-title-'));
  const previousHome = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  const require = createRequire(import.meta.url);
  const cache = new Map<string, any>();
  const updates: any[] = [];
  let current: any;
  let onConnect = () => {};
  let onUpdate = () => {};
  let failUpdate = false;
  let failSave = false;
  const prompt = 'Проверь заявки на сайте';
  const hooks = new Map<string, any>();
  const events = new Map<string, any>();
  const handlers = new Map<string, any>();
  const server = {
    before(name: string, fn: any) { hooks.set(name, fn); return () => {}; },
    on(name: string, fn: any) { events.set(name, fn); return () => {}; },
    handle(contract: any, fn: any) { handlers.set(contract.name, fn); },
  };
  function load(file: string): any {
    if (cache.has(file)) return cache.get(file);
    const exports: any = {};
    cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    new Function('exports', 'require', code)(exports, (id: string) => {
      if (id === '@getpaseo/plugin') return { defineRpc: (value: any) => value };
      if (id === './transfer-client') return { transferClient: async () => {
        onConnect();
        return { updateAgent: async (id: string, value: any) => {
          if (failUpdate) throw new Error('offline');
          updates.push({ id, ...value });
          onUpdate();
          // The actual 0.13.2 metadata operation retains archivedAt, unlike resume/import.
          current.title = value.name;
        }, close: async () => {} };
      } };
      if (id === 'node:fs/promises') return { ...require(id), writeFile: async (...args: any[]) => {
        if (failSave) { failSave = false; throw new Error('disk'); }
        return require(id).writeFile(...args);
      } };
      return id.startsWith('.') ? load(resolve(dirname(file), id + '.ts')) : require(id);
    });
    return exports;
  }
  let stop: any;
  const paseo = {
    agents: { ref: (id: string) => {
      assert.equal(id, current.id);
      return { refresh: async () => ({ agent: structuredClone(current) }), timeline: {
        refetch: async () => ({ entries: [{ item: { type: 'user_message', text: prompt } }], hasOlder: false }),
      } };
    } },
    workspaces: { ref: () => ({ refresh: async () => ({ id: 'w' }) }) },
  };
  let token: string;
  const create = async (id: string, title: string | null = prompt, bind = true) => {
    id = randomUUID();
    current = { id, cwd: "/fixture", title, provider: 'codex', workspaceId: 'w', labels: {}, archivedAt: null };
    onConnect = onUpdate = () => {};
    failUpdate = false;
    const request = await hooks.get('agent.create')({ request: { config: {
      provider: 'codex', cwd: '/fixture', title, systemPrompt: 'Existing instruction',
      mcpServers: { existing: { type: 'http', url: 'http://fixture' } },
      toolPolicy: { preapproved: [{ kind: 'mcp', server: 'existing', tool: 'keep' }] },
    }, env: { KEEP: 'yes' } } });
    token = request.config.mcpServers.dialogs_title.env.PASEO_DIALOGS_TITLE_TOKEN;
    assert.equal(request.env.KEEP, 'yes');
    assert.ok(request.config.systemPrompt.startsWith('Existing instruction\n\n'));
    assert.equal(request.config.mcpServers.existing.url, 'http://fixture');
    assert.equal(request.config.mcpServers.dialogs_title.env.PASEO_DIALOGS_TITLE_TOKEN, token);
    assert.equal(request.config.toolPolicy.preapproved.length, 2);
    assert.equal(await hooks.get('agent.create')({ request }), undefined, 'instruction is idempotent');
    await mkdir(join(home, 'agents/fixture'), { recursive: true });
    await writeFile(join(home, 'agents/fixture', `${id}.json`), JSON.stringify({ id, cwd: '/fixture', config: request.config }));
    if (bind) await events.get('agent.created')({ agent: current });
    return request;
  };
  const call = (title = 'Проверка заявок', capability = token) => handlers.get('dialogs.self-title')({ token: capability, title }, { paseo });
  try {
    await writeFile(join(home, 'config.json'), JSON.stringify({ plugins: { 'paseo-dialogs': { path: resolve('.') } } }));
    const { registerSelfTitle, selfTitle } = load(resolve('server/self-title.ts'));
    stop = registerSelfTitle(server);
    await t.test('first call verifies name; duplicate calls and later topics cannot rename again', async () => {
      await create('plain');
      assert.equal((await call()).status, 'renamed');
      assert.equal(current.title, 'Проверка заявок');
      const before = updates.length;
      assert.equal((await call('Полив цветов')).status, 'unchanged');
      assert.equal(updates.length, before);
      assert.equal(selfTitle.input.safeParse({ token, title: 'Проверка заявок', agentId: 'victim' }).success, false);
      await assert.rejects(call('Проверка заявок', '11111111-1111-4111-8111-111111111111'), /scope_denied/);
    });
    await t.test('concurrent duplicate calls produce one metadata write', async () => {
      await create('parallel');
      const before = updates.length;
      await Promise.all([call(), call()]);
      assert.equal(updates.length, before + 1);
    });
    await t.test('manual initial title and a manual edit while connecting are preserved', async () => {
      await create('manual', 'Личное название');
      const before = updates.length;
      assert.equal((await call()).status, 'preserved');
      await create('manual-race');
      onConnect = () => { current.title = 'Другое название'; };
      assert.equal((await call()).status, 'preserved');
      assert.equal(current.title, 'Другое название');
      assert.equal(updates.length, before);
    });
    await t.test('Kanban assignment while connecting keeps the latest number', async () => {
      await create('kanban-race');
      onConnect = () => { current.labels['kanban.key'] = 'AGM-24'; current.title = `AGM-24: ${prompt}`; };
      await call();
      assert.equal(current.title, 'AGM-24: Проверка заявок');
    });
    await t.test('archived agents and children cannot be renamed; history opens never bind scope', async () => {
      const before = updates.length;
      await create('archived'); current.archivedAt = '2026-10-31';
      assert.equal((await call()).status, 'preserved');
      await create('archive-race'); onConnect = () => { current.archivedAt = '2026-10-31'; };
      assert.equal((await call()).status, 'preserved');
      await create('child'); current.parentAgentId = 'parent';
      assert.equal((await call()).status, 'preserved');
      assert.equal(updates.length, before);
      assert.equal(hooks.has('agent.session_open'), false);
      await assert.rejects(call('Проверка заявок', 'history'), /scope_denied/);
    });
    await t.test('archive during the metadata write is retained', async () => {
      await create('during-write'); onUpdate = () => { current.archivedAt = '2026-10-31'; };
      await call();
      assert.equal(current.archivedAt, '2026-10-31');
    });
    await t.test('retry after transient update failure and reload uses persisted scope', async () => {
      await create('retry'); failUpdate = true;
      await assert.rejects(call(), /offline/);
      await stop(); stop = registerSelfTitle(server);
      failUpdate = false;
      await call();
      assert.equal(current.title, 'Проверка заявок');
    });
    await t.test('a lost completion write recovers without renaming twice, including after reload', async () => {
      await create('lost-save'); onUpdate = () => { failSave = true; };
      await assert.rejects(call(), /disk/);
      const before = updates.length;
      await stop(); stop = registerSelfTitle(server);
      assert.equal((await call()).status, 'unchanged');
      assert.equal(updates.length, before);
      assert.equal((await call()).status, 'unchanged');
    });
    await t.test('MCP before created safely retries; pending binding survives reload without session_open', async () => {
      await create('early', prompt, false);
      await assert.rejects(call(), /binding_pending/);
      await stop(); stop = registerSelfTitle(server);
      await events.get('agent.created')({ agent: current });
      await call();
      assert.equal(current.title, 'Проверка заявок');
    });
    await t.test('invalid title and MCP name collision are rejected', async () => {
      await create('validation');
      await assert.rejects(call('Hello'), /invalid_title/);

      await assert.rejects(hooks.get('agent.create')({ request: { config: { mcpServers: { dialogs_title: {} } } } }), /name_conflict/);
    });
    const state = JSON.parse(await readFile(join(home, 'plugin-data/paseo-dialogs/self-titles.json'), 'utf8'));
    assert.ok(Object.values(state).some((record: any) => record.done));
    assert.equal(state.history, undefined);
    assert.equal(readFileSync(resolve('server/runtime.ts'), 'utf8').includes('startNaming'), false);
    assert.equal(readFileSync(resolve('server/runtime.ts'), 'utf8').includes('cliproxy'), false);
  } finally {
    await stop?.();
    if (previousHome === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
