import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

test('created hook persists candidates; completed hook titles once, preserves manual edits and Kanban races', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dialogs-title-'));
  const previousHome = process.env.PASEO_HOME;
  const previousFetch = globalThis.fetch;
  process.env.PASEO_HOME = home;
  const require = createRequire(import.meta.url);
  const cache = new Map<string, any>();
  const updates: string[][] = [];
  let requests = 0;
  let failures: string[] = [];
  let writeFailures = 0;
  let renameFailures = 0;
  let generatedTitle = 'Проверка заявок';
  const logs: string[] = [];
  const previousLog = console.log;
  const previousError = console.error;
  console.log = console.error = (...args) => { logs.push(args.join(' ')); };
  let duringGeneration = () => {};
  globalThis.fetch = async (_url, options: any) => {
    assert.equal(JSON.parse(options.body).max_tokens, 256);
    assert.ok(options.signal);
    requests++;
    duringGeneration();
    const failure = failures.shift();
    if (failure === 'generation') throw new TypeError('fixture offline');
    if (failure === 'validation') return { ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) } as Response;
    return { ok: true, json: async () => ({ choices: [{ message: { content: generatedTitle } }] }) } as Response;
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
      ? { ...require(id), writeFile: async (...args: any[]) => {
        if (writeFailures > 0) { writeFailures--; throw new Error('fixture disk unavailable'); }
        return require(id).writeFile(...args);
      }, readFile: async (path: string, ...args: any[]) => path.endsWith('/cliproxy.env')
        ? 'CLIPROXY_URL_MAC=http://fixture.invalid\nCLIPROXY_KEY_MAC=fixture' : require(id).readFile(path, ...args) }
      : id === 'node:child_process' ? { execFile: (_: string, args: string[], _options: any, callback: any) => {
        updates.push(args);
        if (renameFailures > 0) { renameFailures--; callback(new Error('fixture rename failed')); return; }
        callback(null, '', '');
      } } : require(id));
    return exports;
  }
  let stop: (() => Promise<void>) | undefined;
  try {
    const events = new Map<string, any>();
    const handlers = new Map<string, any>();
    stop = load(resolve('server/runtime.ts')).register({ handle(contract: any, fn: any) { handlers.set(contract.name, fn); }, on(name: string, fn: any) {
      events.set(name, fn); return () => {};
    } });
    const prompt = 'Проверь заявки';
    let current: any;
    const timelineCalls: any[] = [];
    let empty = false;
    let workspace: any = { id: 'w' };
    const entry = (item: any, seq: number) => ({ provider: 'codex', item,
      timestamp: '2026-10-25T17:00:00.000Z', seqStart: seq, seqEnd: seq,
      sourceSeqRanges: [{ startSeq: seq, endSeq: seq }], turnId: 'turn', collapsed: [] });
    const page = (entries: any[], hasOlder = false) => ({
      requestId: 'request', agentId: current.id, agent: structuredClone(current),
      direction: 'before', projection: 'projected', epoch: 'epoch', reset: false,
      staleCursor: false, gap: false, window: { minSeq: 1, maxSeq: 4, nextSeq: 5 },
      startCursor: { epoch: 'epoch', seq: entries[0]?.seqStart ?? 1 },
      endCursor: { epoch: 'epoch', seq: entries.at(-1)?.seqEnd ?? 1 },
      hasOlder, hasNewer: false, entries, error: null,
    });
    const history = async (options: any) => {
      timelineCalls.push(options);
      assert.equal(options.direction, 'before');
      if (empty) return page([]);
      if (current.id === 'pagination' && !options.cursor) return page([
        entry({ type: 'user_message', text: 'Следующее сообщение' }, 3),
        entry({ type: 'assistant_message', text: 'Ответ' }, 4),
      ], true);
      if (options.cursor) assert.deepEqual(options.cursor, { epoch: 'epoch', seq: 3 });
      const entries = [
        entry({ type: 'user_message', text: prompt }, 1),
        entry({ type: 'assistant_message', text: 'Ответ' }, 2),
        entry({ type: 'user_message', text: 'Следующее сообщение' }, 3),
        entry({ type: 'assistant_message', text: 'Ответ' }, 4),
      ];
      return page(options.cursor ? entries.slice(0, 2) : entries);
    };
    const paseo = {
      workspaces: { list: async () => ({ entries: [], pageInfo: {} }), ref: () => ({ refresh: async () => workspace }) },
      agents: { ref: () => ({ refresh: async () => ({ agent: structuredClone(current) }), timeline: {
        append: async () => {}, refetch: history,
      } }) },
    };
    for (const scenario of ['plain', 'prefix', 'prefix-race', 'manual', 'manual-race', 'pagination', 'service-word', 'empty-retry']) {
      current = { id: scenario, workspaceId: 'w', title: scenario === 'manual' ? 'Ручное название' : prompt };
      await events.get('agent.created')({ agent: structuredClone(current) }, { paseo });
      const saved = JSON.parse(await readFile(join(home, 'plugin-data/paseo-dialogs/state.json'), 'utf8'));
      assert.ok(saved.candidates[scenario]);
      if (scenario === 'prefix') Object.assign(current, { title: `AGM-11: ${prompt}`, labels: { 'kanban.key': 'AGM-11' } });
      duringGeneration = () => {
        if (scenario === 'prefix-race') Object.assign(current, { title: `AGM-11: ${prompt}`, labels: { 'kanban.key': 'AGM-11' } });
        if (scenario === 'manual-race') current.title = 'Название человека';
      };
      generatedTitle = scenario === 'service-word' ? 'Фокус и вкладки' : 'Проверка заявок';
      const count = updates.length;
      const calls = timelineCalls.length;
      if (scenario === 'empty-retry') {
        empty = true;
        const requestCount = requests;
        await events.get('agent.turn_ended')({ agent: current, outcome: { kind: 'completed' } }, { paseo });
        assert.equal(timelineCalls.length - calls, 3);
        assert.equal(requests, requestCount);
        assert.ok(JSON.parse(await readFile(join(home, 'plugin-data/paseo-dialogs/state.json'), 'utf8')).candidates[scenario]);
        assert.ok(logs.some(line => line.includes('отложено') && line.includes(scenario)));
        empty = false;
      }
      await events.get('agent.turn_ended')({ agent: current, outcome: { kind: 'completed' } }, { paseo });
      const expected = scenario.startsWith('manual') ? 0 : 1;
      assert.equal(updates.length - count, expected, scenario);
      if (expected) assert.equal(updates.at(-1)![updates.at(-1)!.indexOf('--name') + 1], scenario.startsWith('prefix') ? `AGM-11: ${generatedTitle}` : generatedTitle);
      if (scenario === 'pagination') assert.equal(timelineCalls.length - calls, 2);
      assert.equal(JSON.parse(await readFile(join(home, 'plugin-data/paseo-dialogs/state.json'), 'utf8')).candidates[scenario], undefined);
      await events.get('agent.turn_ended')({ agent: current, outcome: { kind: 'completed' } }, { paseo });
      assert.equal(updates.length - count, expected, 'one attempt only');
    }
    assert.equal(requests, 7);
    current = { id: 'concurrent', workspaceId: 'w', title: prompt };
    await events.get('agent.created')({ agent: structuredClone(current) }, { paseo });
    empty = true;
    const count = updates.length;
    const previousCalls = timelineCalls.length;
    const pending = events.get('agent.turn_ended')({ agent: current, outcome: { kind: 'completed' } }, { paseo });
    while (timelineCalls.length === previousCalls) await new Promise(resolve => setTimeout(resolve, 1));
    await events.get('agent.turn_ended')({ agent: current, outcome: { kind: 'completed' } }, { paseo });
    assert.ok(logs.some(line => line.includes('попытка уже выполняется') && line.includes('concurrent')));
    empty = false;
    await pending;
    assert.equal(updates.length - count, 1);
    for (const [agent, kind, space, reason] of [
      [{ id: 'failed', workspaceId: 'w' }, 'failed', { id: 'w' }, 'незавершённый ход'],
      [{ id: 'child', workspaceId: 'w', parentAgentId: 'parent' }, 'completed', { id: 'w' }, 'не головной чат'],
      [{ id: 'no-workspace' }, 'completed', { id: 'w' }, 'нет пространства'],
      [{ id: 'background', workspaceId: 'w' }, 'completed', { id: 'w', background: true }, 'пространство недоступно'],
      [{ id: 'no-candidate', workspaceId: 'w' }, 'completed', { id: 'w' }, 'нет кандидата'],
    ] as const) {
      current = agent;
      workspace = space;
      await events.get('agent.turn_ended')({ agent, outcome: { kind } }, { paseo });
      assert.ok(logs.some(line => line.includes(reason) && line.includes(agent.id)), reason);
    }
    workspace = { id: 'w' };
    const savedCandidate = async (id: string) => JSON.parse(await readFile(join(home, 'plugin-data/paseo-dialogs/state.json'), 'utf8')).candidates[id];
    const create = async (id: string) => {
      current = { id, workspaceId: 'w', title: prompt };
      duringGeneration = () => {};
      await events.get('agent.created')({ agent: structuredClone(current) }, { paseo });
    };
    const end = () => events.get('agent.turn_ended')({ agent: current, outcome: { kind: 'completed' } }, { paseo });
    await t.test('generation and invalid title recover within three durable attempts', async () => {
      await create('transient');
      failures = ['generation', 'validation'];
      const before = requests;
      await end();
      assert.equal(requests - before, 3);
      assert.equal(updates.at(-1)![updates.at(-1)!.indexOf('--name') + 1], generatedTitle);
      assert.equal(await savedCandidate('transient'), undefined);
      assert.ok(logs.some(line => line.includes('stage generation attempt 1')));
      assert.ok(logs.some(line => line.includes('stage title_validation attempt 2')));
    });
    await t.test('permanent failures stay bounded across later turns and reconnects', async () => {
      await create('bounded');
      failures = ['generation', 'generation', 'generation'];
      const before = requests;
      await end();
      assert.equal(requests - before, 3);
      assert.equal((await savedCandidate('bounded')).attempts, 3);
      await end();
      await handlers.get('dialogs.state')({}, { paseo });
      assert.equal(requests - before, 3);
    });
    await t.test('rename failure retains generated title and retries without another model call', async () => {
      await create('rename-error');
      renameFailures = 1;
      const before = requests;
      const writes = updates.length;
      await end();
      assert.equal(requests - before, 1);
      assert.equal(updates.length - writes, 2);
      assert.equal(await savedCandidate('rename-error'), undefined);
    });
    await t.test('exhausted rename failures preserve the durable candidate and cached title', async () => {
      await create('rename-exhausted');
      renameFailures = 3;
      const before = requests;
      const writes = updates.length;
      await end();
      assert.equal(requests - before, 1);
      assert.equal(updates.length - writes, 3);
      const candidate = await savedCandidate('rename-exhausted');
      assert.equal(candidate.attempts, 3);
      assert.equal(candidate.generated, generatedTitle);
      await end();
      assert.equal(updates.length - writes, 3);
    });
    await t.test('state write failure retains candidate and generated title', async () => {
      await create('disk-error');
      const before = requests;
      duringGeneration = () => { writeFailures = 1; };
      await end();
      assert.equal(requests - before, 1);
      assert.equal(await savedCandidate('disk-error'), undefined);
      assert.ok(logs.some(line => line.includes('disk-error') && line.includes('ошибка')));
    });
    await t.test('manual rename during a retry is preserved', async () => {
      await create('manual-retry');
      failures = ['generation'];
      const before = updates.length;
      duringGeneration = () => { current.title = 'Ручное название'; };
      await end();
      assert.equal(updates.length, before);
      assert.equal(current.title, 'Ручное название');
      assert.equal(await savedCandidate('manual-retry'), undefined);
    });
    await t.test('persisted completion resumes after reload and reconnect without regenerating its title', async () => {
      await create('reconnect');
      await stop!();
      const statePath = join(home, 'plugin-data/paseo-dialogs/state.json');
      const saved = JSON.parse(await readFile(statePath, 'utf8'));
      saved.candidates.reconnect = { title: prompt, completed: true, attempts: 1, generated: generatedTitle };
      await writeFile(statePath, JSON.stringify(saved));
      const before = requests;
      const writes = updates.length;
      stop = load(resolve('server/runtime.ts')).register({
        handle(contract: any, fn: any) { handlers.set(contract.name, fn); },
        on(name: string, fn: any) { events.set(name, fn); return () => {}; },
      });
      await handlers.get('dialogs.state')({}, { paseo });
      await stop!();
      assert.equal(requests, before);
      assert.equal(updates.length - writes, 1);
      assert.equal(await savedCandidate('reconnect'), undefined);
      assert.equal((await savedCandidate('bounded')).attempts, 3);
    });
    const firstPrompt = load(resolve('server/first-prompt.ts')).firstPrompt;
    await assert.rejects(firstPrompt({ refetch: async () => ({ ...page([]), hasOlder: true, startCursor: null }) }), /timeline_missing_cursor/);
    await assert.rejects(firstPrompt({ refetch: async () => ({ ...page([]), hasOlder: true }) }), /timeline_repeated_cursor/);
    for (const line of logs) assert.ok(!line.includes(prompt), 'logs exclude prompt text');
  } finally {
    await stop?.();
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    console.error = previousError;
    if (previousHome === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
