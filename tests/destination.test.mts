import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React, { useEffect } from "react";
import { act, create } from "react-test-renderer";
import ts from "typescript";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);

function fixture() {
  const calls: string[] = [];
  let committed = false;
  let refresh = async () => {};
  let active = true;
  const api = { agents: { ref: () => ({ refresh: () => refresh() }) } };
  const navigation = {
    openAgent: ({ agentId }: any) => calls.push(`${committed ? "agent" : "lost"}:${agentId}`),
    openWorkspace: () => calls.push("workspace"),
  };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync("client/destination.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("exports", "require", code)(exports, (id: string) => {
    if (id === "react-native") return Object.fromEntries(["ActivityIndicator", "Pressable", "Text", "View"].map(key => [key, key]));
    if (id === "@getpaseo/plugin/client") return { usePaseo: () => api, useRpc: () => async () => ({ claimed: true }) };
    if (id === "../shared/contracts") return {};
    if (id === "../shared/model") return { topLevel: () => true };
    if (id === "./web") return { isNavigationScreenActive: () => active, openArchivedAgent: async () => false };
    return require(id);
  });
  function Parent({ params, navigation: nav }: any) {
    useEffect(() => { committed = true; }, []);
    return React.createElement(exports.Destination, {
      params, navigation: nav, host: { id: "test-host" }, theme: { colors: {} },
    });
  }
  let root: any;
  return {
    calls,
    setRefresh: (fn: () => Promise<void>) => { refresh = fn; },
    deactivate: () => { active = false; },
    mount: (params = { agentId: "a" } as any) => act(() => { root = create(React.createElement(Parent, { params, navigation })); }),
    rerender: (params: any) => act(() => root.update(React.createElement(Parent, { params, navigation: { ...navigation } }))),
    text: () => JSON.stringify(root.toJSON()),
    retry: () => act(() => root.root.findByType("Pressable").props.onPress()),
    unmount: () => act(() => root.unmount()),
  };
}

const tick = async (t: any, ms = 1) => { await act(async () => { t.mock.timers.tick(ms); }); };

test("native redirect waits for the parent stack commit and renders loading", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = fixture();
  await app.mount();
  assert.deepEqual(app.calls, []);
  assert.match(app.text(), /Открываем диалог/);
  await tick(t);
  assert.deepEqual(app.calls, ["agent:a"]);
  await app.unmount();
});

test("equivalent params and new navigation identity do not cancel or replay an in-flight redirect", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = fixture();
  let resolve!: () => void;
  app.setRefresh(() => new Promise<void>(r => { resolve = r; }));
  await app.mount({ agentId: "a", workspaceId: "w" });
  await tick(t);
  await app.rerender({ agentId: "a", workspaceId: "w" });
  await act(async () => resolve());
  assert.deepEqual(app.calls, ["agent:a"]);
  await app.rerender({ agentId: "a", workspaceId: "w" });
  await tick(t);
  assert.deepEqual(app.calls, ["agent:a"]);
  await app.unmount();
});

test("refresh failure exposes an error and retry navigates without an intermediate workspace", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = fixture();
  app.setRefresh(async () => { throw new Error("relay disconnected"); });
  await app.mount({ agentId: "a", workspaceId: "w" });
  await tick(t);
  assert.match(app.text(), /relay disconnected/);
  app.setRefresh(async () => {});
  await app.retry();
  await tick(t);
  assert.deepEqual(app.calls, ["agent:a"]);
  await app.unmount();
});

test("hanging refresh times out and its late result cannot navigate after retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = fixture();
  let resolve!: () => void;
  app.setRefresh(() => new Promise<void>(r => { resolve = r; }));
  await app.mount({ agentId: "a", workspaceId: "w" });
  await tick(t);
  await tick(t, 15_000);
  assert.match(app.text(), /Переход не завершился/);
  app.setRefresh(async () => {});
  await app.retry();
  await tick(t);
  await act(async () => resolve());
  assert.deepEqual(app.calls, ["agent:a"]);
  await app.unmount();
});

for (const scenario of ["unmount", "new-request", "web-route-left"] as const) {
  test(`late refresh cannot steal navigation after ${scenario}`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const app = fixture();
    let resolve!: () => void;
    app.setRefresh(() => new Promise<void>(r => { resolve = r; }));
    await app.mount({ agentId: "a", workspaceId: "w" });
    await tick(t);
    if (scenario === "unmount") await app.unmount();
    if (scenario === "new-request") { await app.rerender({ agentId: "b" }); await tick(t); }
    if (scenario === "web-route-left") app.deactivate();
    await act(async () => resolve());
    assert.deepEqual(app.calls, scenario === "new-request" ? ["agent:b"] : []);
    if (scenario !== "unmount") await app.unmount();
  });
}

test("router silently ignoring a redirect produces retry UI instead of a permanent blank screen", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = fixture();
  await app.mount();
  await tick(t);
  await tick(t, 15_000);
  assert.match(app.text(), /Переход не завершился/);
  await app.retry();
  await tick(t);
  assert.deepEqual(app.calls, ["agent:a", "agent:a"]);
  await app.unmount();
});

test("native archived agent uses the same single host navigation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = fixture();
  await app.mount({ agentId: "archived", workspaceId: "w", archived: "true" });
  await tick(t);
  assert.deepEqual(app.calls, ["agent:archived"]);
  await app.unmount();
});

test("unmount before the scheduled native redirect does not navigate", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = fixture();
  await app.mount();
  await app.unmount();
  await tick(t);
  assert.deepEqual(app.calls, []);
});
