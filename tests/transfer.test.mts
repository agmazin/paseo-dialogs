import { test } from "node:test";
import assert from "node:assert/strict";
import { transfer, supported, transferProblem, type TransferClient } from "../server/transfer.ts";
import type { PaseoAgent } from "@getpaseo/client";

const input = { agentId: "a", sourceId: "source", targetId: "target" };
function fixture(archived = false) {
  let a = {
    id: "a", workspaceId: "source", cwd: "/test", provider: "claude",
    title: "Ручное имя", labels: { project: "one" }, status: "idle",
    pendingPermissions: [], archivedAt: archived ? "yesterday" : null,
    persistence: { sessionId: "session", provider: "claude" },
  } as unknown as PaseoAgent;
  const calls: string[] = [];
  let failTarget = false, failRollback = false, failMetadata = false;
  const client: TransferClient = {
    fetchAgent: async () => ({ agent: structuredClone(a) }),
    archiveAgent: async () => { calls.push("archive"); a.archivedAt = "now"; },
    importAgent: async p => {
      calls.push("import:" + p.workspaceId);
      if ((p.workspaceId === "target" && failTarget) || (p.workspaceId === "source" && failRollback))
        throw new Error("injected");
      assert.equal(p.sessionId, "session");
      assert.equal(p.cwd, "/test");
      a.workspaceId = p.workspaceId; a.archivedAt = null;
      return structuredClone(a);
    },
    updateAgent: async (_, p) => {
      if (failMetadata && a.workspaceId === "target") throw new Error("metadata");
      calls.push("metadata"); a.title = p.name ?? a.title; a.labels = p.labels;
    },
    close: async () => {},
  };
  return { client, calls, get: () => a,
    fail: (target: boolean, rollback = false, metadata = false) => {
      failTarget = target; failRollback = rollback; failMetadata = metadata;
    } };
}
const hooks = { before: async () => {}, restore: async () => {} };
test("move keeps identity, session, name, labels; restores own state after import", async () => {
  const f = fixture(); let restored = false;
  const result = await transfer(f.client, input, {
    before: async a => { assert.equal(a.title, "Ручное имя"); assert.deepEqual(f.calls, []); },
    restore: async a => { restored = true; assert.equal(a.id, "a"); },
  });
  assert.deepEqual(result, { agentId: "a", workspaceId: "target", archived: false });
  assert.deepEqual(f.calls, ["archive", "import:target", "metadata"]);
  assert.equal(f.get().title, "Ручное имя"); assert.deepEqual(f.get().labels, { project: "one" });
  assert.ok(restored);
});
test("native import restores archived conversation as active at destination", async () => {
  const f = fixture(true); await transfer(f.client, input, hooks);
  assert.equal(f.get().workspaceId, "target"); assert.equal(f.get().archivedAt, null);
});
test("running, initializing, pending permission and active turn cannot be moved", async () => {
  for (const patch of [{status:"running"}, {status:"initializing"}, {pendingPermissions:[{}]},
    {attentionReason:"permission"}, {activeTurn:{id:"turn"}}, {pendingPermissionCount:1}]) {
    const f = fixture(); Object.assign(f.get(), patch);
    await assert.rejects(transfer(f.client, input, hooks), /когда агент закончит/);
    assert.deepEqual(f.calls, []);
  }
});
test("stale source and absent session fail before archive", async () => {
  const f = fixture();
  await assert.rejects(transfer(f.client, {...input,sourceId:"other"}, hooks), /уже перемещён/);
  assert.deepEqual(f.calls, []);
  f.get().persistence = null;
  assert.ok(transferProblem(f.get()));
  await assert.rejects(transfer(f.client, input, hooks), /сохранённых/);
  assert.deepEqual(f.calls, []);
});
test("failed target import rolls back same session and archive state", async () => {
  for (const archived of [false, true]) {
    const f = fixture(archived); f.fail(true);
    await assert.rejects(transfer(f.client, input, hooks), /восстановлен/);
    assert.equal(f.get().workspaceId, "source");
    assert.equal(!!f.get().archivedAt, archived);
    if (!archived) assert.ok(f.calls.includes("import:source"));
  }
});
test("failure restoring metadata rolls back from target", async () => {
  const f = fixture(); f.fail(false, false, true);
  await assert.rejects(transfer(f.client, input, hooks), /восстановлен/);
  assert.equal(f.get().workspaceId, "source");
});
test("failed rollback includes recovery session and source", async () => {
  const f = fixture(); f.fail(true, true);
  await assert.rejects(transfer(f.client, input, hooks), /claude: session.*source/);
});
test("missing internal method disables transfer before any mutation", async () => {
  const f = fixture(); (f.client as any).importAgent = undefined;
  assert.equal(supported(f.client), false);
  await assert.rejects(transfer(f.client, input, hooks), /Данные не изменены/);
  assert.deepEqual(f.calls, []);
});
test("failed recovery write and newly started turn do not archive an agent", async () => {
  const f = fixture();
  await assert.rejects(transfer(f.client, input, {...hooks,before:async()=>{throw new Error("disk");}}), /disk/);
  assert.deepEqual(f.calls, []);
  await assert.rejects(transfer(f.client, input, {...hooks,before:async()=>{f.get().status="running";}}));
  assert.deepEqual(f.calls, []);
});
