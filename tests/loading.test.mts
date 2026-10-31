import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedLoad, dialogLoadState } from "../client/loading.ts";
import { restoreUnreadMarkers } from "../server/restore.ts";
import { readFileSync } from "node:fs";
import ts from "typescript";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("dialog list has explicit initial, cached-refetch, error and reconnect states", () => {
  const base = { connected: true, hasData: false, fetching: true, error: false };
  assert.equal(dialogLoadState(base), "loading");
  assert.equal(dialogLoadState({ ...base, connected: false }), "connecting");
  assert.equal(dialogLoadState({ ...base, hasData: true }), "refreshing");
  assert.equal(dialogLoadState({ ...base, fetching: false, error: true }), "error");
  assert.equal(dialogLoadState({ ...base, hasData: true, fetching: false, error: true }), "stale-error");
  assert.equal(dialogLoadState({ ...base, hasData: true, fetching: false }), "ready");
});

test("slow load is pending, timeout aborts its children, retry can succeed", async () => {
  const slow = deferred<string>();
  let signal!: AbortSignal;
  const read = boundedLoad((lifetime) => { signal = lifetime; return slow.promise; }, new AbortController().signal, 10);
  await assert.rejects(read, /timed out/);
  assert.ok(signal.aborted);
  slow.resolve("stale response");
  assert.equal(await boundedLoad(async () => "current", new AbortController().signal), "current");
});

test("dispose before scheduled load prevents RPC; dispose while pending ignores late result", async () => {
  const stopped = new AbortController();
  stopped.abort();
  let calls = 0;
  await assert.rejects(boundedLoad(async () => { calls++; return "bad"; }, stopped.signal), /cancelled/);
  assert.equal(calls, 0);
  const late = deferred<string>();
  const lifetime = new AbortController();
  const read = boundedLoad(() => late.promise, lifetime.signal);
  await Promise.resolve();
  lifetime.abort();
  await assert.rejects(read, /cancelled/);
  late.reject(new Error("late disconnected RPC"));
  await new Promise((resolve) => setImmediate(resolve));
});

test("unread restoration has two bounded workers and retains tokens on timeout", async () => {
  const unread = { a: "ta", b: "tb", c: "tc" };
  let active = 0;
  let peak = 0;
  const writes: string[] = [];
  await restoreUnreadMarkers({
    unread, stopped: () => false,
    read: async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      return [];
    },
    append: async (id) => { writes.push(id); },
    save: async () => { writes.push("save"); }, report: () => {},
  }, { requestTimeoutMs: 2, totalTimeoutMs: 3 });
  assert.ok(peak <= 2);
  assert.deepEqual(unread, { a: "ta", b: "tb", c: "tc" });
  assert.deepEqual(writes, []);
});

test("late restore cannot revive read markers or delete a newer turn token", async () => {
  const unread = { read: "old", changed: "old" };
  const read = deferred<[]>();
  const changed = deferred<[]>();
  const appends: string[] = [];
  let saves = 0;
  const task = restoreUnreadMarkers({
    unread, stopped: () => false,
    read: (id) => id === "read" ? read.promise : changed.promise,
    append: async (id) => { appends.push(id); },
    save: async () => { saves++; }, report: () => {},
  });
  unread.read = "";
  unread.changed = "new";
  read.resolve([]);
  changed.reject(new Error("old provider error"));
  await task;
  assert.deepEqual(unread, { read: "", changed: "new" });
  assert.deepEqual(appends, []);
  assert.equal(saves, 0);
});

test("cleanup prevents late append, error logging and save", async () => {
  let stopped = false;
  const reply = deferred<[]>();
  let effects = 0;
  const task = restoreUnreadMarkers({ unread: { a: "token" }, stopped: () => stopped,
    read: () => reply.promise, append: async () => { effects++; },
    save: async () => { effects++; }, report: () => { effects++; },
  });
  stopped = true;
  reply.reject(new Error("disposed RPC"));
  await task;
  assert.equal(effects, 0);
});

test("native status uses theme colors and Retry in light/dark without DOM", () => {
  const exports: any = {};
  const native = { View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "Spinner" };
  const jsx = (type: string, props: any) => ({ type, props });
  const code = ts.transpileModule(readFileSync(new URL("../client/load-status.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("exports", "require", code)(exports, (id: string) => {
    if (id === "react-native") return native;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    throw new Error(id);
  });
  const walk = (node: any): any[] => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(2).flatMap(walk)];
  for (const foreground of ["#111111", "#eeeeee"]) {
    const theme = { colors: { foreground, foregroundMuted: "#888888", statusDanger: "#dd3333", border: "#777777" } };
    for (const state of ["loading", "connecting", "refreshing", "error", "stale-error"]) {
      let retries = 0;
      const tree = exports.DialogLoadStatus({ state, theme, retry: () => { retries++; } });
      const nodes = walk(tree);
      assert.ok(nodes.some((node) => node.type === "Text" && node.props.children));
      assert.ok(!JSON.stringify(tree).includes("history"));
      const button = nodes.find((node) => node.type === "Pressable");
      if (state.includes("error")) { button.props.onPress(); assert.equal(retries, 1); }
      else assert.equal(button, undefined);
    }
    assert.equal(exports.DialogLoadStatus({ state: "ready", theme, retry: () => {} }), null);
  }
});
