import { dialogAction } from "../shared/contracts";
import { handleDialogAction } from "./dialog-action";
import { restoreUnreadMarkers } from "./restore";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readFile, mkdir, rename, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  readState,
  reorderGroups,
  preference,
  markRead,
  stateSchema,
  claimAction,
  moveDialog,
  readAgents,
  readArchive,
} from "../shared/contracts";
import { registerSelfTitle } from "./self-title";
import { transfer } from "./transfer";
import { transferClient } from "./transfer-client";
import { latest, slim, topLevel, type FullAgent } from "../shared/model";
import { reconcileOrder, moveGroup } from "../shared/order";
import type { PaseoApi } from "@getpaseo/client";
const directory = join(
  process.env.PASEO_HOME || join(homedir(), ".paseo"),
  "plugin-data",
  "paseo-dialogs",
);
const path = join(directory, "state.json");
type State = {
  groupOrder: string[];
  collapsed: Record<string, boolean>;
  archives: Record<string, boolean>;
  unread: Record<string, string>;
  candidates: Record<string, { title: string | null; completed?: boolean; attempts?: number; generated?: string }>;
  actions: Record<string, number>;
  // When a turn of an agent started or ended: real activity, unlike Paseo's updatedAt.
  turns: Record<string, string>;
};
export function register(server: PluginServerContext) {
  const stopSelfTitle = registerSelfTitle(server);
  const moving = new Set<string>();
  const transfers = new Set<Promise<unknown>>();
  let state: State = {
    groupOrder: [],
    collapsed: {},
    archives: {},
    unread: {},
    candidates: {},
    actions: {},
    turns: {},
  };
  const ready = (async () => {
    try {
      const saved = JSON.parse(await readFile(path, "utf8"));
      state = {
        ...stateSchema.parse(saved),
        candidates: saved.candidates ?? {},
        actions: saved.actions ?? {},
        turns: saved.turns ?? {},
      };
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT")
        console.error("Диалоги: не удалось прочитать состояние");
    }
  })();
  let queue = Promise.resolve();
  const save = () => {
    const data = JSON.stringify(state, null, 2);
    queue = queue
      .catch(() => {})
      .then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(`${path}.tmp`, data, { mode: 0o600 });
        await rename(`${path}.tmp`, path);
      });
    return queue;
  };
  // Serialize snapshots with lifecycle events, so an old list cannot undo an archive.
  let orderQueue = Promise.resolve();
  const orderTask = <T,>(fn: () => Promise<T>): Promise<T> => {
    const result = orderQueue.then(fn);
    orderQueue = result.then(() => {}, () => {});
    return result;
  };
  const reconcile = async (paseo: PaseoApi) => {
    const active: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await paseo.workspaces.list({ page: { limit: 200, cursor } });
      active.push(...result.entries.filter(w => !w.background && !w.archivingAt).map(w => w.id));
      cursor = result.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    const next = reconcileOrder(state.groupOrder, active);
    if (JSON.stringify(next) !== JSON.stringify(state.groupOrder)) {
      const previous = state.groupOrder;
      state.groupOrder = next;
      try { await save(); } catch (error) { state.groupOrder = previous; throw error; }
    }
  };
  server.handle(reorderGroups, async ({ id, beforeId }, { paseo }) => orderTask(async () => {
    await ready;
    await reconcile(paseo);
    const previous = state.groupOrder;
    state.groupOrder = moveGroup(previous, id, beforeId);
    try { await save(); } catch (error) { state.groupOrder = previous; throw error; }
    return snapshot();
  }));
  const offWorkspaceCreated = server.on("workspace.created", async (_, { paseo }) => orderTask(async () => {
    await ready;
    await reconcile(paseo);
  }));
  const offWorkspaceArchived = server.on("workspace.archived", async ({ workspace }) => orderTask(async () => {
    await ready;
    state.groupOrder = state.groupOrder.filter(id => id !== workspace.id);
    delete state.collapsed[workspace.id];
    delete state.archives[workspace.id];
    await save();
  }));
  server.handle(dialogAction, (input, { paseo }) => handleDialogAction(input, paseo));
  server.handle(moveDialog, async (input, { paseo }) => {
    await ready;
    if (moving.has(input.agentId)) throw new Error("Диалог уже переносится");
    moving.add(input.agentId);
    const operation = (async () => {
      const target = await paseo.workspaces.ref(input.targetId).refresh();
      const source = await paseo.workspaces.ref(input.sourceId).refresh();
      if (!source || !target || source.archivingAt || source.background ||
          target.archivingAt || target.background || source.workspaceDirectory !== target.workspaceDirectory)
        throw new Error("Нужна активная папка в том же каталоге");
      const client = await transferClient(process.env.PASEO_HOME || join(homedir(), ".paseo"));
      const unread = state.unread[input.agentId];
      const recoveryPath = join(directory, `move-${input.agentId}.json`);
      try {
        try {
          const pending = JSON.parse(await readFile(recoveryPath, "utf8"));
          throw new Error(`Предыдущий перенос не завершён. Сессия ${pending.provider}: ${pending.sessionId}. Нужна помощь оркестратора.`);
        } catch (error) {
          if ((error as {code?: string}).code !== "ENOENT") throw error;
        }
        return await transfer(client, input, {
          before: async (agent, live) => {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            await writeFile(recoveryPath, JSON.stringify({
              agentId: agent.id, sourceId: input.sourceId, targetId: input.targetId,
              provider: agent.provider, sessionId: agent.persistence!.sessionId,
              cwd: agent.cwd, title: agent.title, labels: agent.labels,
              archived: !!agent.archivedAt, unread,
              subagents: live.map(d => ({ id: d.id, provider: d.provider, sessionId: d.persistence?.sessionId, workspaceId: d.workspaceId })),
            }), { mode: 0o600 });
          },
          restore: async (agent) => {
            delete state.candidates[agent.id]; // This is an existing conversation.
            if (unread !== undefined) state.unread[agent.id] = unread;
            await save();
            if (unread) await paseo.agents.ref(agent.id).timeline.append({
              type: "plugin", id: `read-${unread}`, kind: "read-marker", version: 1,
              data: { agentId: agent.id, token: unread },
            });
            await unlink(recoveryPath).catch(error => { if (error.code !== "ENOENT") throw error; });
          },
        });
      } finally { await client.close(); }
    })();
    transfers.add(operation);
    try { return await operation; }
    finally { moving.delete(input.agentId); transfers.delete(operation); }
  });
  server.handle(claimAction, async ({ token }) => {
    await ready;
    if (state.actions[token]) return { claimed: false };
    state.actions[token] = Date.now();
    await save();
    return { claimed: true };
  });
  let restored: Promise<void> | undefined;
  let restorationComplete = false;
  let stopped = false;
  const restoreLifetime = new AbortController();
  const snapshot = () => ({ ...state, unread: { ...state.unread }, restoring: !!restored && !restorationComplete });
  // Top-level dialogs, plus live subagents when asked: the list shows them under a parent at rest.
  const topLevelAgents = async (paseo: PaseoApi, withRunningSubagents = false) => {
    let cursor: string | undefined;
    const rows: FullAgent[] = [];
    do {
      const r = await paseo.agents.list({ filter: { includeArchived: true }, page: { limit: 200, cursor } });
      for (const { agent } of r.entries)
        if (topLevel(agent) || (withRunningSubagents && !agent.archivedAt)) rows.push(agent);
      cursor = r.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    return rows;
  };
  const recent = (a: FullAgent, b: FullAgent) =>
    (b.lastUserMessageAt ?? b.createdAt).localeCompare(a.lastUserMessageAt ?? a.createdAt);
  const withTurns = (a: FullAgent) => {
    const row = slim(a);
    return { ...row, lastActivityAt: latest(row.lastActivityAt, state.turns[a.id]) };
  };
  let turnSave: ReturnType<typeof setTimeout> | undefined;
  const markTurn = (id: string) => {
    state.turns[id] = new Date().toISOString();
    if (!turnSave) turnSave = setTimeout(() => ((turnSave = undefined), void save().catch(() => {})), 2000);
  };
  const offTurnStarted = server.on("agent.turn_started", async ({ agent }) => {
    await ready;
    markTurn(agent.id);
  });
  const offTurnMarked = server.on("agent.turn_ended", async ({ agent }) => {
    await ready;
    markTurn(agent.id);
  });
  server.handle(readAgents, async ({ archives, limit }, { paseo }) => {
    const all = await topLevelAgents(paseo, true);
    const open = new Set(archives);
    const archiveCounts: Record<string, number> = {};
    const archived = new Map<string, FullAgent[]>();
    for (const a of all) {
      if (!a.archivedAt || !a.workspaceId) continue;
      archiveCounts[a.workspaceId] = (archiveCounts[a.workspaceId] ?? 0) + 1;
      if (open.has(a.workspaceId)) archived.set(a.workspaceId, [...(archived.get(a.workspaceId) ?? []), a]);
    }
    const shown = [...archived.values()].flatMap((list) => list.sort(recent).slice(0, limit));
    return { agents: [...all.filter((a) => !a.archivedAt), ...shown].map(withTurns), archiveCounts };
  });
  server.handle(readArchive, async ({ workspaceId }, { paseo }) => ({
    agents: (await topLevelAgents(paseo)).filter((a) => a.archivedAt && a.workspaceId === workspaceId).map(withTurns),
  }));
  server.handle(readState, async ({ waitForRestore }, { paseo }) => {
    await ready;
    if (!waitForRestore) await orderTask(() => reconcile(paseo));
    if (!restored && !Object.values(state.unread).some(Boolean)) {
      restorationComplete = true;
      restored = Promise.resolve();
    }
    restored ??= restoreUnreadMarkers({
      unread: state.unread,
      stopped: () => stopped,
      signal: restoreLifetime.signal,
      read: async (agentId) => (await paseo.agents.ref(agentId).timeline.refetch({ direction: "before", limit: 100 }))
        .entries.map((entry) => entry.item),
      append: async (agentId, token) => {
        if (stopped || state.unread[agentId] !== token) return;
        await paseo.agents.ref(agentId).timeline.append({
          type: "plugin", id: `read-${token}`, kind: "read-marker", version: 1,
          data: { agentId, token },
        });
      },
      save,
      report: () => console.error("Диалоги: восстановление маркера недоступно, используется родной статус"),
    }).catch(() => {
      if (!stopped) console.error("Диалоги: не удалось сохранить восстановленные маркеры");
    }).finally(() => { restorationComplete = true; });
    if (waitForRestore) await restored;
    return snapshot();
  });
  server.handle(preference, async ({ section, id, value }) => {
    await ready;
    state[section][id] = value;
    await save();
    return snapshot();
  });
  server.handle(markRead, async ({ agentId, token }) => {
    await ready;
    if (moving.has(agentId)) return {};
    // Late observers cannot acknowledge a newer answer.
    if (state.unread[agentId] === token) {
      state.unread[agentId] = "";
      await save();
    }
    return {};
  });
  const offEnded = server.on(
    "agent.turn_ended",
    async ({ agent, outcome }, { paseo }) => {
      await ready;
      if (
        outcome.kind !== "completed" ||
        !topLevel(agent) ||
        !agent.workspaceId
      ) {
        const reason = outcome.kind !== "completed" ? "незавершённый ход" : !topLevel(agent) ? "не головной чат" : "нет пространства";
        console.log("Диалоги: маркер пропущен, " + reason, agent.id, outcome.kind);
        return;
      }
      const workspace = await paseo.workspaces.ref(agent.workspaceId).refresh();
      if (!workspace || workspace.background || workspace.archivingAt) {
        console.log("Диалоги: маркер пропущен, пространство недоступно", agent.id);
        return;
      }
      const token = randomUUID();
      try {
        state.unread[agent.id] = token;
        await save();
        await paseo.agents
          .ref(agent.id)
          .timeline.append({
            type: "plugin",
            id: `read-${token}`,
            kind: "read-marker",
            version: 1,
            data: { agentId: agent.id, token },
          });
      } catch {
        delete state.unread[agent.id];
        await save();
        console.error("Диалоги: маркер недоступен, используется родной статус");
      }
    },
  );
  console.log("Диалоги: сервер запущен");
  return async () => {
    stopped = true;
    restoreLifetime.abort();
    await stopSelfTitle();
    offEnded();
    await Promise.allSettled([...transfers]);
    offWorkspaceCreated();
    offWorkspaceArchived();
    await orderQueue;
    offTurnStarted();
    offTurnMarked();
    if (turnSave) (clearTimeout(turnSave), await save().catch(() => {}));
    await queue;
  };
}
