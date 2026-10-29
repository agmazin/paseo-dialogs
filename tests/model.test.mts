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
  assert.equal(validTitle("Фокус и вкладки"), "Фокус и вкладки");
  assert.equal(validTitle("Планы для работы"), "Планы для работы");
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

test("activity time ignores renames: last message or finished turn, never updatedAt", async () => {
  const { latest, slim } = await import("../shared/model.ts");
  assert.equal(latest(null, "2026-10-22T10:00:00.000Z", undefined, "2026-10-22T09:00:00.000Z"), "2026-10-22T10:00:00.000Z");
  const row = slim({
    id: "a", provider: "claude", status: "idle", createdAt: "2026-10-20T10:00:00.000Z",
    lastUserMessageAt: "2026-10-21T22:37:00.000Z", attentionTimestamp: "2026-10-21T22:38:00.000Z",
    lastActivityAt: "2026-10-22T12:25:00.000Z",
  });
  assert.equal(row.lastActivityAt, "2026-10-21T22:38:00.000Z");
});

test("automatic titles tolerate only their own Kanban prefix and preserve it across a race", async () => {
  const { replacementTitle } = await import("../shared/model.ts");
  const prompt = "Проверь автоматическое название диалога о заявках. Ответь только словом Проверено";
  const initial = prompt.slice(0, 60);
  const base = { id: "a", provider: "claude", status: "idle", createdAt: "2026-10-23" };
  const plain = { ...base, title: initial };
  const numbered = { ...plain, title: `AGM-11: ${initial}`, labels: { "kanban.key": "AGM-11" } };
  assert.equal(autoTitle(numbered.title, prompt, "AGM-11"), true);
  assert.equal(autoTitle(numbered.title, prompt), false);
  assert.equal(replacementTitle(numbered, plain, prompt, "Проверка заявок"), "AGM-11: Проверка заявок");
  assert.equal(replacementTitle(plain, plain, prompt, "Проверка заявок"), "Проверка заявок");
  for (const title of ["Моё название", "AGM-11: Моё название", `ECO-17: ${initial}`]) {
    assert.equal(autoTitle(title, prompt, "AGM-11"), false);
    assert.equal(replacementTitle({ ...numbered, title }, numbered, prompt, "Проверка заявок"), null);
  }
  assert.equal(replacementTitle({ ...numbered, archivedAt: "2026-10-23" }, numbered, prompt, "Проверка заявок"), null);
  assert.equal(replacementTitle({ ...numbered, parentAgentId: "p" }, numbered, prompt, "Проверка заявок"), null);
});

test("Alexander waiting has priority over running for every state and survives slim RPC rows", async () => {
  const { waitingReason, waitingHint, slim } = await import("../shared/model.ts");
  for (const status of ["running", "initializing", "idle", "error"]) {
    for (const [extra, reason] of [
      [{ pendingPermissions: [{}] }, "permission"],
      [{ pendingPermissionCount: 1 }, "permission"],
      [{ attentionReason: "permission" }, "permission"],
      [{ labels: { kanban: "ask" } }, "ask"],
      [{ labels: { kanban: "review" } }, "review"],
      [{ labels: { kanban: "review" }, pendingPermissions: [{}] }, "permission"],
    ] as const) {
      const a = { id: "a", provider: "codex", createdAt: "2026-10-25", status, ...extra };
      assert.equal(waitingReason(a), reason);
      assert.equal(bucket(a), "needs_input");
      if (!("pendingPermissionCount" in extra)) assert.equal(bucket(slim(a)), "needs_input");
      assert.equal(waitingReason({ ...a, archivedAt: "2026-10-25" }), null);
    }
  }
  assert.equal(waitingHint("permission"), "Ждёт тебя: разрешение");
  assert.equal(waitingHint("ask"), "Ждёт тебя: вопрос");
  assert.equal(waitingHint("review"), "Ждёт тебя: приёмка");
  for (const kanban of ["done", "accepted", "queue"]) assert.equal(waitingReason({ status: "idle", labels: { kanban } }), null);
});

test("waiting descendants propagate across idle ancestors, count once and never count as working", async () => {
  const { branchStatus, waitingReason } = await import("../shared/model.ts");
  const agents = [
    { id: "root", status: "running", parentAgentId: null },
    { id: "bridge", status: "idle", parentAgentId: "root" },
    { id: "permission", status: "running", parentAgentId: "bridge", pendingPermissionCount: 1 },
    { id: "ask", status: "idle", parentAgentId: "root", labels: { kanban: "ask" } },
    { id: "review", status: "idle", parentAgentId: "bridge", labels: { kanban: "review" } },
    { id: "worker", status: "running", parentAgentId: "root" },
    { id: "archive", status: "running", parentAgentId: "root", pendingPermissionCount: 1, archivedAt: "2026-10-25" },
  ];
  const kids = runningByParent(agents);
  assert.deepEqual(kids.get("root")!.map(a => a.id), ["permission", "ask", "review", "worker"]);
  assert.equal(kids.get("root")!.filter(a => waitingReason(a)).length, 3);
  assert.equal(branchStatus(agents[0], kids.get("root")!), "needs_input");
  assert.equal(branchStatus(agents[1], kids.get("bridge")!), "needs_input");
  assert.equal(branchStatus({ status: "idle" }, [agents[5]]), "running");
  assert.equal(branchStatus({ status: "running" }, []), "running");
  assert.equal(branchStatus({ status: "idle", labels: { kanban: "ask" } }, [agents[5]]), "needs_input");
  const cycle = runningByParent([{ id: "a", status: "running", parentAgentId: "b" }, { id: "b", status: "running", parentAgentId: "a" }]);
  assert.equal(cycle.get("a")!.length, 1);
});
