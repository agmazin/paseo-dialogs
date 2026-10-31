import { test } from "node:test";
import assert from "node:assert/strict";
import { sidebarClient } from "./helpers/sidebar-client.mts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test("slow state keeps the native loading label and starts independent lists in parallel", async () => {
  const app = sidebarClient();
  try {
    app.pause();
    app.render();
    await settle();
    assert.equal(app.render().loadState, "loading");
    assert.ok(app.calls.includes("workspaces"));
    assert.ok(app.calls.includes("terminals"));
    assert.ok(!app.calls.includes("agents"));
    app.resume();
    await settle();
    assert.equal(app.render().loadState, "ready");
  } finally { app.dispose(); }
});

test("late initial state after disconnect/cleanup cannot start a new agents request", async () => {
  const app = sidebarClient();
  app.pause();
  app.render();
  await settle();
  app.dispose();
  app.resume();
  await settle();
  assert.ok(!app.calls.includes("agents"));
});

test("initial rejection has an explicit error and Retry fetches the data", async () => {
  const app = sidebarClient();
  try {
    app.setFailure(true);
    app.render();
    await settle();
    const failed = app.render();
    assert.equal(failed.data, undefined);
    assert.equal(failed.loadState, "error");
    app.setFailure(false);
    await app.refetch();
    assert.equal(app.render().loadState, "ready");
  } finally { app.dispose(); }
});

test("native list fetches once across rerenders, keeps cache on error, and retries/reconnects", async () => {
  const app = sidebarClient();
  try {
    assert.equal(app.render().loadState, "loading");
    await settle();
    assert.equal(app.render().loadState, "ready");
    assert.equal(app.calls.filter((name) => name === "state").length, 1);
    for (let index = 0; index < 50; index++) app.render();
    assert.equal(app.calls.filter((name) => name === "state").length, 1);
    app.setFailure(true);
    await app.refetch();
    const stale = app.render();
    assert.equal(stale.loadState, "stale-error");
    assert.ok(stale.data);
    app.setFailure(false);
    await app.refetch();
    assert.equal(app.render().loadState, "ready");
    app.connect(false);
    assert.equal(app.render().loadState, "connecting");
    const requests = app.calls.length;
    app.render();
    assert.equal(app.calls.length, requests);
    app.connect(true);
    assert.equal(app.render().loadState, "ready");
  } finally { app.dispose(); }
});

test("background marker completion updates the existing list with one follow-up", async () => {
  const app = sidebarClient();
  try {
    app.setRestoring(true);
    app.render();
    await settle();
    const initial = app.render();
    assert.equal(initial.loadState, "ready");
    assert.equal(initial.data.state.restoring, true);
    await settle();
    for (let index = 0; index < 20; index++) app.render();
    assert.equal(app.calls.filter((name) => name === "state-wait").length, 1);
    app.finish();
    await settle();
    const complete = app.render();
    assert.equal(complete.data.state.restoring, false);
    assert.equal(complete.data.state.unread.a, "");
    assert.equal(complete.data.workspaces.length, 1);
  } finally { app.dispose(); }
});

test("a fulfilled subscription releases during cleanup even while its sibling never resolves", async () => {
  const app = sidebarClient();
  let releases = 0;
  const stop = app.subscribeOnce({
    agents: { list: async () => ({ subscription: { release: async () => { releases++; } } }) },
    workspaces: { list: () => new Promise(() => {}) },
  });
  await settle();
  stop();
  await settle();
  assert.equal(releases, 1);
  app.dispose();
});
