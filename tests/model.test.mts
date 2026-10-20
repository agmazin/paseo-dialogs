import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucket,
  autoTitle,
  validTitle,
  topLevel,
  activityTime,
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
