import { test } from "node:test";
import assert from "node:assert/strict";
import { transfer, supported, transferProblem, type TransferClient } from "../server/transfer.ts";
import type { PaseoAgent } from "@getpaseo/client";

const input = { agentId: "a", sourceId: "source", targetId: "target" };
function fixture(archived = false, subs: Partial<PaseoAgent>[] = []) {
  let a = {
    id: "a", workspaceId: "source", cwd: "/test", provider: "claude",
    title: "Ручное имя", labels: { project: "one" }, status: "idle",
    pendingPermissions: [], archivedAt: archived ? "yesterday" : null,
    persistence: { sessionId: "session", provider: "claude" },
  } as unknown as PaseoAgent;
  const calls: string[] = [];
  // Subagents: archiving the chat archives them too, as Paseo 0.12 does.
  const kids = subs.map((k, i) => ({
    id: `k${i}`, workspaceId: "source", cwd: "/test", provider: "claude", title: `Карточка ${i}`,
    labels: { "paseo.parent-agent-id": "a" }, status: "idle", pendingPermissions: [], archivedAt: null,
    persistence: { sessionId: `s${i}`, provider: "claude" }, ...k,
  }) as unknown as PaseoAgent);
  const byId = (id: string) => (id === "a" ? a : kids.find(k => k.id === id)!);
  let failTarget = false, failRollback = false, failMetadata = false;
  const client: TransferClient = {
    fetchAgents: async () => ({ entries: [a, ...kids].map(agent => ({ agent: structuredClone(agent) })), pageInfo: {} }),
    fetchAgent: async id => ({ agent: structuredClone(byId(id)) }),
    archiveAgent: async () => {
      assert.ok(a.labels["paseo.transfer-at"]);
      for (const child of kids.filter(k => !k.archivedAt)) assert.equal(child.labels["paseo.transfer-at"], a.labels["paseo.transfer-at"]);
      calls.push("archive"); a.archivedAt = "now";
      for (const k of kids) {
        if (k.archivedAt) continue;
        if (k.workspaceId === a.workspaceId) { k.archivedAt = "now"; k.status = "closed"; }
        else { const { "paseo.parent-agent-id": _, ...rest } = k.labels as Record<string, string>; k.labels = rest; }
      }
    },
    importAgent: async p => {
      const kid = kids.find(k => k.persistence!.sessionId === p.sessionId);
      if (kid) {
        calls.push(`revive:${kid.id}`);
        if (kid.title === "сломан") throw new Error("injected");
        kid.archivedAt = null; kid.status = "idle"; return structuredClone(kid);
      }
      calls.push("import:" + p.workspaceId);
      if ((p.workspaceId === "target" && failTarget) || (p.workspaceId === "source" && failRollback))
        throw new Error("injected");
      assert.equal(p.sessionId, "session");
      assert.equal(p.cwd, "/test");
      a.workspaceId = p.workspaceId; a.archivedAt = null;
      return structuredClone(a);
    },
    updateAgent: async (id, p) => {
      if (id !== "a") { calls.push(`update:${id}`); byId(id).labels = { ...byId(id).labels, ...p.labels }; return; }
      if (failMetadata && a.workspaceId === "target") throw new Error("metadata");
      calls.push("metadata"); a.title = p.name ?? a.title; a.labels = p.labels;
    },
    close: async () => {},
  };
  return { client, calls, get: () => a, kid: byId,
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
  assert.deepEqual(f.calls, ["metadata", "archive", "import:target", "metadata"]);
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
  await assert.rejects(transfer(f.client, {...input,targetId:input.sourceId}, hooks), { message: "Выберите другую папку" });
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
    await assert.rejects(transfer(f.client, input, hooks), { message: "Перенос не выполнен. Диалог восстановлен в исходной папке." });
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

test("subagents: not archived ones come back after the move, archived stay, the chat keeps its new place", async () => {
  const f = fixture(false, [{}, { archivedAt: "old" }, { labels: { "paseo.parent-agent-id": "k0" } }]);
  await transfer(f.client, input, hooks);
  assert.equal(f.get().workspaceId, "target");
  assert.deepEqual(f.calls, ["metadata", "update:k0", "update:k2", "archive", "import:target", "metadata", "revive:k0", "update:k0", "revive:k2", "update:k2"]);
  const [k0, k1, k2] = await Promise.all(["k0", "k1", "k2"].map(async id => (await f.client.fetchAgent(id))!.agent));
  assert.equal(k0.archivedAt, null); assert.equal(k0.workspaceId, "source");
  assert.equal(k1.archivedAt, "old"); assert.equal(k2.archivedAt, null);
});
test("a working subagent blocks the move before anything changes", async () => {
  for (const patch of [{ status: "running" }, { labels: { "paseo.parent-agent-id": "k0" }, status: "initializing" }]) {
    const f = fixture(false, [{}, patch]);
    await assert.rejects(transfer(f.client, input, hooks), { message: "У чата работают подагенты: 1. Перенос после их окончания" });
    assert.deepEqual(f.calls, []);
  }
  // Started between the check and the archive: still nothing changes, the reason is the same.
  const f = fixture(false, [{}]);
  await assert.rejects(transfer(f.client, input, { ...hooks, before: async () => { f.kid("k0").status = "running"; } }),
    { message: "У чата работают подагенты: 1. Перенос после их окончания" });
  assert.deepEqual(f.calls, []);
});
test("a subagent that does not come back is reported, the chat stays moved", async () => {
  const f = fixture(false, [{ title: "сломан" }, {}]);
  await assert.rejects(transfer(f.client, input, hooks), /Подагенты остались в архиве \(1\): claude: s0/);
  assert.equal(f.get().workspaceId, "target");
  assert.equal((await f.client.fetchAgent("k1"))!.agent.archivedAt, null);
});

test("subagents in another workspace lose their parent on archive: the move gives it back", async () => {
  const f = fixture(false, [{ workspaceId: "elsewhere" }, { workspaceId: "elsewhere", archivedAt: "old" }]);
  await transfer(f.client, input, hooks);
  assert.deepEqual(f.calls, ["metadata", "update:k0", "archive", "import:target", "metadata", "update:k0"]);
  assert.equal(f.kid("k0").labels["paseo.parent-agent-id"], "a");
  assert.equal(f.kid("k0").archivedAt, null);
});
