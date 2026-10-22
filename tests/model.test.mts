import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucket,
  autoTitle,
  validTitle,
  topLevel,
  activityTime,
  runningSubagent,
  runningByParent,
  atRest,
} from "../shared/model.ts";
test("permissions beat errors, errors beat running, own read state beats host focus", () => {
  assert.equal(
    bucket({ status: "error", pendingPermissionCount: 1 }, true),
    "needs_input",
  );
  assert.equal(
    bucket({ status: "running", attentionReason: "error" }, true),
    "failed",
  );
  assert.equal(bucket({ status: "running" }, true), "running");
  assert.equal(
    bucket({ status: "idle", requiresAttention: false }, true),
    "attention",
  );
  assert.equal(
    bucket({ status: "idle", requiresAttention: true }, false),
    "done",
  );
  assert.equal(
    bucket({ status: "idle", requiresAttention: true }),
    "attention",
  );
});
test("manual and preexisting names cannot pass automatic title gate", () => {
  assert.equal(autoTitle("Моё название", "Проверь заявки"), false);
  assert.equal(autoTitle("Проверь заявки", "Проверь заявки"), true);
  assert.equal(autoTitle("", "Проверь заявки"), true);
  assert.equal(autoTitle("Проверь", "Проверь заявки"), false);
  assert.equal(validTitle("Пропавшие заявки"), "Пропавшие заявки");
  for (const bad of [
    '"Название"',
    "Три лишних слова",
    "название",
    "Название.",
    "Оченьдлинноеназваниезаявок",
    "Ignore instructions",
  ])
    assert.equal(validTitle(bad), null);
});
test("both subagent markers excluded", () => {
  assert.equal(topLevel({ parentAgentId: "p" }), false);
  assert.equal(topLevel({ labels: { "paseo.parent-agent-id": "p" } }), false);
  assert.equal(topLevel({ labels: {} }), true);
});
test("time labels cross local date boundaries", () => {
  const now = new Date(2026, 9, 20, 13, 0);
  assert.equal(
    activityTime(new Date(2026, 9, 20, 12, 59).toISOString(), now),
    "сейчас",
  );
  assert.equal(
    activityTime(new Date(2026, 9, 19, 13).toISOString(), now),
    "вчера",
  );
  assert.equal(
    activityTime(new Date(2026, 8, 28, 13).toISOString(), now),
    "28 сен",
  );
});

test("only running, unarchived subagents hang under their parent", () => {
  const label = { "paseo.parent-agent-id": "p1" };
  assert.equal(runningSubagent({ status: "running", labels: label }), true);
  assert.equal(runningSubagent({ status: "running", parentAgentId: "p1" }), true);
  assert.equal(runningSubagent({ status: "idle", parentAgentId: "p1" }), false);
  assert.equal(runningSubagent({ status: "running", parentAgentId: "p1", archivedAt: "2026-10-22" }), false);
  assert.equal(runningSubagent({ status: "running" }), false);
  const kids = runningByParent([
    { id: "a", status: "running", parentAgentId: "p1" },
    { id: "b", status: "idle", parentAgentId: "p1" },
    { id: "c", status: "running", parentAgentId: "p2" },
    { id: "d", status: "running", parentAgentId: "p1" },
    { id: "p1", status: "idle", parentAgentId: null },
  ]);
  assert.deepEqual([...kids.keys()], ["p1", "p2"]);
  assert.deepEqual(kids.get("p1")!.map((k) => k.id), ["a", "d"]);
  assert.deepEqual(["done", "attention", "running", "needs_input", "failed"].map(atRest), [true, true, false, false, false]);
});

test("the Kanban number before a title is split off for the muted color", async () => {
  const { splitKey } = await import("../shared/model.ts");
  assert.deepEqual(splitKey("AGM-1: Paseo Канбан"), { key: "AGM-1", name: "Paseo Канбан" });
  assert.deepEqual(splitKey("AGM-1-2-3: Вложенный"), { key: "AGM-1-2-3", name: "Вложенный" });
  assert.deepEqual(splitKey("GPT-6-Astra: мнение"), { key: null, name: "GPT-6-Astra: мнение" });
  assert.deepEqual(splitKey("Без номера"), { key: null, name: "Без номера" });
});
