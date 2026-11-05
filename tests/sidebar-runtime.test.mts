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

test("orphan Kanban cards stay out of dialogs, archive rows and counts", async () => {
  const base = { provider: "codex", status: "idle", workspaceId: "w", createdAt: "2026-11-05" };
  const cards = [
    { id: "card", labels: { "kanban.key": "AGM-12-4" }, title: "Без префикса" },
    { id: "deep", labels: { "kanban.key": "ECO-3-14-2" } },
    { id: "fallback", title: "AGM-12-7: Карточка" },
  ];
  const roots = [{ id: "root", labels: { "kanban.key": "AGM-12" } }, { id: "plain", title: "Без номера" }];
  const fixtures = [...cards, ...roots].flatMap(a => [
    { ...base, ...a },
    { ...base, ...a, id: `${a.id}-archived`, archivedAt: "2026-11-05" },
  ]);
  const app = await sidebarRuntime({ agents: fixtures });
  try {
    const { topLevel } = await import("../shared/model.ts");
    for (const archives of [[], ["w"]]) {
      const result = await app.call("agents", { archives, limit: 30 });
      assert.deepEqual(result.archiveCounts, { w: 2 });
      assert.deepEqual(result.agents.filter(topLevel).map(a => a.id).sort(),
        (archives.length ? ["root", "plain", "root-archived", "plain-archived"] : ["root", "plain"]).sort());
    }
    assert.deepEqual((await app.call("archive", { workspaceId: "w" })).agents.map(a => a.id).sort(), ["plain-archived", "root-archived"]);
  } finally { await app.close(); }
});
