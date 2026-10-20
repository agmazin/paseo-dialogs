import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileOrder, moveGroup } from '../shared/order.ts';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

test('new spaces append, archived IDs vanish, restored IDs append, duplicates vanish', () => {
  const saved = reconcileOrder(['b','a','b','gone'], ['a','b','c']);
  assert.deepEqual(saved, ['b','a','c']);
  assert.deepEqual(reconcileOrder(saved, ['a','b','c','gone']), ['b','a','c','gone']);
  assert.deepEqual(moveGroup(saved, 'c', 'b'), ['c','b','a']);
  assert.deepEqual(moveGroup(saved, 'b', null), ['a','c','b']);
  assert.deepEqual(moveGroup(saved, 'gone', 'a'), saved);
  assert.deepEqual(moveGroup(saved, 'a', 'gone'), saved);
});

test('real RPC handlers persist and reload order, archive then restore appends, preferences survive', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dialogs-order-'));
  const previous = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  const require = createRequire(import.meta.url);
  // Load the actual TS runtime with only the host contract factory substituted.
  let failWrite = false;
  const cache = new Map<string, any>();
  function load(file: string): any {
    if (cache.has(file)) return cache.get(file);
    const exports: any = {};
    cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    }}).outputText;
    new Function('exports','require',code)(exports, (id: string) => id === '@getpaseo/plugin'
      ? {defineRpc: (value: any) => value} : id.startsWith('.')
      ? load(resolve(dirname(file), id + '.ts')) : id === 'node:fs/promises' ? {...require(id), rename: async (...args: any[]) => {
        if (failWrite) throw new Error('disk unavailable');
        return require(id).rename(...args);
      }} : require(id));
    return exports;
  }
  try {
    const directory = join(home,'plugin-data/paseo-dialogs');
    await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'state.json'),JSON.stringify({collapsed:{old:true},archives:{},unread:{},candidates:{},actions:{}}));
    const { register } = load(resolve('server/runtime.ts'));
    let ids = ['a', 'b', 'c'];
    const paseo = {workspaces:{list:async () => ({entries:ids.map(id=>({id})),pageInfo:{}})}};
    function boot() {
      const handlers = new Map<string, any>(), events = new Map<string, any>();
      const stop = register({handle:(contract: any, fn: any)=>handlers.set(contract.name, fn),
        on:(name: string, fn: any)=>{events.set(name, fn);return ()=>events.delete(name)}});
      return {stop, events, call:(name: string, input = {}) => handlers.get('dialogs.'+name)(input,{paseo})};
    }
    const first = boot();
    assert.deepEqual((await first.call('state')).groupOrder, ids);
    await first.call('preference', {section:'collapsed',id:'a',value:true});
    await first.call('reorder-groups', {id:'c',beforeId:'a'});
    await first.stop();
    const disk = JSON.parse(await readFile(join(home,'plugin-data/paseo-dialogs/state.json'),'utf8'));
    assert.deepEqual(disk.groupOrder, ['c','a','b']);
    const second = boot();
    assert.deepEqual((await second.call('state')).groupOrder, ['c','a','b']);
    assert.equal((await second.call('state')).collapsed.a, true);
    ids = ['a','b'];
    await second.events.get('workspace.archived')({workspace:{id:'c'}},{paseo});
    ids = ['a','b','c','d'];
    await second.events.get('workspace.created')({workspace:{id:'c'}},{paseo});
    assert.deepEqual((await second.call('state')).groupOrder, ['a','b','c','d']);
    await second.call('reorder-groups', {id:'b',beforeId:'a'});
    assert.deepEqual((await second.call('state')).groupOrder, ['b','a','c','d']);
    failWrite = true;
    await assert.rejects(second.call('reorder-groups', {id:'a',beforeId:'b'}), /disk unavailable/);
    failWrite = false;
    assert.deepEqual((await second.call('state')).groupOrder, ['b','a','c','d']);
    await second.call('reorder-groups', {id:'a',beforeId:'b'});
    assert.deepEqual((await second.call('state')).groupOrder, ['a','b','c','d']);
    await second.stop();
  } finally {
    if (previous === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = previous;
    await rm(home, {recursive:true, force:true});
  }
});
