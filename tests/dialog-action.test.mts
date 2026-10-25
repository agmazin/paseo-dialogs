import { test } from "node:test";
import assert from "node:assert/strict";
import { executeDialogAction } from "../server/transfer.ts";

function fixture() {
  const records: any[] = [
    { id: "root", title: "AGM-14: Имя", labels: { "kanban.key": "AGM-14" }, workspaceId: "w", provider: "claude", persistence: { sessionId: "persisted" }, runtimeInfo: { sessionId: "runtime" } },
    { id: "child", labels: { "paseo.parent-agent-id": "root" }, workspaceId: "w" },
    { id: "grandchild", labels: { "paseo.parent-agent-id": "child" }, workspaceId: "w" },
    { id: "other", labels: { "paseo.parent-agent-id": "root" }, workspaceId: "other" },
    { id: "old", labels: { "paseo.parent-agent-id": "root" }, workspaceId: "w", archivedAt: "old" },
  ];
  const updates: any[] = [];
  const client: any = {
    fetchAgent: async (id: string) => ({ agent: records.find(a => a.id === id) }),
    fetchAgents: async () => ({ entries: records.map(agent => ({ agent })), pageInfo: {} }),
    updateAgent: async (id: string, value: any) => { updates.push({ id, ...value }); },
    archiveAgent: async () => { assert.deepEqual(updates.map(x => x.id), ["root", "child", "grandchild"]); },
    refreshAgent: async (id: string) => updates.push({ reload: id }),
  };
  return { client, updates, records };
}
test("explicit archive labels root and live same-workspace descendants before archive", async () => {
  const { client, updates } = fixture();
  await executeDialogAction(client, { agentId: "root", action: "archive" });
  const stamps = updates.map(a => a.labels["paseo.explicit-archive-at"]);
  assert.equal(new Set(stamps).size, 1);
  assert.equal(new Date(stamps[0]).toISOString(), stamps[0]);
});
test("rename preserves Kanban prefix, resume prefers runtime session, reload uses native action", async () => {
  const { client, updates } = fixture();
  await executeDialogAction(client, { agentId: "root", action: "rename", title: "Другое имя" });
  assert.equal(updates[0].name, "AGM-14: Другое имя");
  assert.deepEqual(await executeDialogAction(client, { agentId: "root", action: "resume" }), { text: "claude --resume runtime" });
  await executeDialogAction(client, { agentId: "root", action: "reload" });
  assert.deepEqual(updates[1], { reload: "root" });
});
