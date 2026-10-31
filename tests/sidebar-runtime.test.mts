import { test } from "node:test";
import assert from "node:assert/strict";
import { sidebarRuntime } from "./helpers/sidebar-runtime.mts";

test("initial state and agents are available while unread history never resolves", async () => {
  const app = await sidebarRuntime({ unread: { stuck: "token" }, read: () => new Promise(() => {}) });
  try {
    const initial = await app.call("state");
    assert.equal(initial.restoring, true);
    assert.deepEqual(initial.unread, { stuck: "token" });
    const rows = await app.call("agents", { archives: [], limit: 30 });
    assert.deepEqual(rows.agents, []);
    await app.call("state");
    assert.equal(app.reads, 1);
  } finally { await app.close(); }
});

test("background completion returns updated state without reviving a read token", async () => {
  let release!: () => void;
  const reply = new Promise<any>((resolve) => { release = () => resolve({ entries: [] }); });
  const app = await sidebarRuntime({ unread: { a: "token" }, read: () => reply });
  try {
    assert.equal((await app.call("state")).restoring, true);
    const waiting = app.call("state", { waitForRestore: true });
    await app.call("read", { agentId: "a", token: "token" });
    release();
    const complete = await waiting;
    assert.equal(complete.restoring, false);
    assert.equal(complete.unread.a, "");
    assert.deepEqual(app.appends, []);
  } finally { await app.close(); }
});

test("unavailable provider falls back once and follow-up exposes the new unread state", async () => {
  const app = await sidebarRuntime({ unread: { bad: "token" }, read: async () => { throw new Error("unavailable provider"); } });
  try {
    await app.call("state");
    const complete = await app.call("state", { waitForRestore: true });
    assert.equal(complete.restoring, false);
    assert.deepEqual(complete.unread, {});
    assert.equal(app.reads, 1);
    assert.equal(app.errors.length, 1);
  } finally { await app.close(); }
});

test("empty unread state is immediately complete without a background follow-up", async () => {
  const app = await sidebarRuntime();
  try {
    assert.equal((await app.call("state")).restoring, false);
    assert.equal(app.reads, 0);
  } finally { await app.close(); }
});
