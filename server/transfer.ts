import type { PaseoAgent } from "@getpaseo/client";

export const unavailable = "Перенос недоступен в этой версии Paseo. Данные не изменены.";
type Page = { entries: { agent: PaseoAgent }[]; pageInfo: { nextCursor?: string | null } };
export type TransferClient = {
  fetchAgents(options: { filter: { includeArchived: boolean }; page: { limit: number; cursor?: string } }): Promise<Page>;
  fetchAgent(id: string): Promise<{ agent: PaseoAgent } | null>;
  archiveAgent(id: string): Promise<unknown>;
  importAgent(input: { provider: string; sessionId: string; cwd: string; workspaceId: string; labels: Record<string, string> }): Promise<PaseoAgent>;
  updateAgent(id: string, input: { name?: string; labels: Record<string, string> }): Promise<unknown>;
  close(): Promise<void>;
};
export function supported(client: unknown): client is TransferClient {
  return !!client && ["fetchAgents", "fetchAgent", "archiveAgent", "importAgent", "updateAgent", "close"]
    .every(key => typeof (client as Record<string, unknown>)[key] === "function");
}
export function transferProblem(a: PaseoAgent) {
  if (a.status === "running" || a.status === "initializing" || a.activeTurn || a.pendingPermissions?.length ||
      a.attentionReason === "permission" || (a as PaseoAgent & { pendingPermissionCount?: number }).pendingPermissionCount)
    return "Перенести можно, когда агент закончит";
  if (!a.workspaceId || !a.persistence?.sessionId || !["claude", "codex"].includes(a.provider))
    return "Перенос доступен для сохранённых диалогов Claude и Codex";
  if ((a as PaseoAgent & { parentAgentId?: string }).parentAgentId || a.labels?.["paseo.parent-agent-id"])
    return "Подчинённый диалог переносить нельзя";
  return null;
}

const parentOf = (a: PaseoAgent) =>
  (a as PaseoAgent & { parentAgentId?: string }).parentAgentId || a.labels?.["paseo.parent-agent-id"] || null;
const busy = (a: PaseoAgent) => a.status === "running" || a.status === "initializing" || !!a.activeTurn ||
  !!a.pendingPermissions?.length || a.attentionReason === "permission" ||
  !!(a as PaseoAgent & { pendingPermissionCount?: number }).pendingPermissionCount;

// Subagents of the chat at any depth, parents first. Archiving the chat (Paseo 0.12) archives those in its
// workspace, a running one is stopped mid-turn, and detaches those in another one (drops the parent label).
export async function descendants(client: TransferClient, id: string) {
  const all: PaseoAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.fetchAgents({ filter: { includeArchived: true }, page: { limit: 200, cursor } });
    all.push(...page.entries.map(e => e.agent));
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  const found: PaseoAgent[] = [];
  const queue = [id];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const a of all) if (parentOf(a) === parent && !found.some(f => f.id === a.id)) { found.push(a); queue.push(a.id); }
  }
  return found;
}
export function subagentsProblem(list: readonly PaseoAgent[]) {
  const n = list.filter(a => !a.archivedAt && busy(a)).length;
  return n ? `У чата работают подагенты: ${n}. Перенос после их окончания` : null;
}

// Same-ID archive/import is the tested Paseo 0.12 contract. Never delete a session.
export async function transfer(client: TransferClient, input: {
  agentId: string; sourceId: string; targetId: string;
}, hooks: {
  before: (agent: PaseoAgent, live: readonly PaseoAgent[]) => Promise<void>;
  restore: (agent: PaseoAgent) => Promise<void>;
}) {
  if (!supported(client)) throw new Error(unavailable);
  const a = (await client.fetchAgent(input.agentId))?.agent;
  if (!a || a.workspaceId !== input.sourceId) throw new Error("Диалог уже перемещён. Обновите список.");
  if (input.sourceId === input.targetId) throw new Error("Выберите другую папку");
  const problem = transferProblem(a);
  if (problem) throw new Error(problem);
  // Subagents that were not archived come back from the archive and get their parent back after the move.
  const live = (await descendants(client, a.id)).filter(d => !d.archivedAt);
  const busySubagents = subagentsProblem(live);
  if (busySubagents) throw new Error(busySubagents);
  const revive = async () => {
    const lost: string[] = [];
    for (const d of live) {
      try {
        const now = (await client.fetchAgent(d.id))?.agent;
        if (!now) throw new Error("gone");
        if (!now.archivedAt && parentOf(now) === parentOf(d)) continue;
        if (now.archivedAt) {
          if (!d.workspaceId || !d.persistence?.sessionId) throw new Error("session");
          await client.importAgent({ provider: d.provider, sessionId: d.persistence.sessionId, cwd: d.cwd,
            workspaceId: d.workspaceId, labels: { ...d.labels } });
        }
        await client.updateAgent(d.id, { ...(d.title ? { name: d.title } : {}),
          labels: { ...d.labels, "paseo.parent-agent-id": parentOf(d)! } });
      } catch { lost.push(`${d.provider}: ${d.persistence?.sessionId ?? d.id}`); }
    }
    if (lost.length) throw new Error(`Подагенты остались в архиве (${lost.length}): ${lost.join(", ")}. Нужна помощь оркестратора.`);
  };
  const request = {
    provider: a.provider, sessionId: a.persistence!.sessionId, cwd: a.cwd,
    labels: { ...a.labels },
  };
  const restore = async (workspaceId: string, archived = false) => {
    const moved = await client.importAgent({ ...request, workspaceId });
    if (moved.id !== a.id || moved.workspaceId !== workspaceId)
      throw new Error("Paseo изменил контракт импорта");
    await client.updateAgent(moved.id, {
      ...(a.title ? { name: a.title } : {}), labels: request.labels,
    });
    // Native import activates the destination; rollback restores the old archive state.
    if (archived) await client.archiveAgent(a.id);
    await hooks.restore(a);
    return moved;
  };
  let moved: PaseoAgent, touched = false;
  await hooks.before(a, live); // Persist recovery details before the first mutation.
  try {
    // Recheck after disk work so a newly started turn is not interrupted.
    const latest = (await client.fetchAgent(a.id))?.agent;
    if (!latest || latest.workspaceId !== a.workspaceId || transferProblem(latest))
      throw new Error("Перенести можно, когда агент закончит");
    const again = subagentsProblem(await Promise.all(live.map(async d => (await client.fetchAgent(d.id))?.agent ?? d)));
    if (again) throw new Error(again);
    const stamp = new Date().toISOString();
    for (const item of [a, ...live]) await client.updateAgent(item.id, { labels: { ...item.labels, "paseo.transfer-at": stamp } });
    touched = true;
    await client.archiveAgent(a.id);
    moved = await restore(input.targetId);
  } catch (error) {
    try {
      const current = (await client.fetchAgent(a.id))?.agent;
      if (!current) throw new Error("Диалог не найден");
      if (current.workspaceId === input.sourceId && !!current.archivedAt === !!a.archivedAt) {
        await hooks.restore(a);
      } else {
        if (transferProblem(current)) throw new Error("Агент начал работу");
        await client.archiveAgent(a.id);
        await restore(input.sourceId, !!a.archivedAt);
      }
      await revive();
    } catch {
      throw new Error(`Перенос и откат не завершены. Сессия ${a.provider}: ${request.sessionId}. Исходная папка: ${input.sourceId}. Нужна помощь оркестратора.`);
    }
    // Nothing was touched yet (a recheck failed): its own reason is clearer.
    if (!touched) throw error;
    throw new Error("Перенос не выполнен. Диалог восстановлен в исходной папке.");
  }
  // The chat is in place; a subagent that did not come back is reported, the move stays.
  await revive();
  return { agentId: moved.id, workspaceId: input.targetId, archived: false };
}

export async function executeDialogAction(client: TransferClient & { refreshAgent?: (id: string) => Promise<unknown> }, input: { agentId: string; action: string; title?: string }) {
    const agent = (await client.fetchAgent(input.agentId))?.agent;
    if (!agent) throw new Error("Диалог не найден");
    if (input.action === "resume") {
      const session = agent.runtimeInfo?.sessionId || agent.persistence?.sessionId;
      const template: Record<string, string> = { claude: "claude --resume", codex: "codex resume", hermes: "hermes --resume", pi: "pi --session", omp: "omp --session", opencode: "opencode --session" };
      if (!session || !template[agent.provider]) throw new Error("Команда продолжения недоступна");
      return { text: `${template[agent.provider]} ${session}` };
    }
    if (input.action === "rename") {
      const title = input.title?.trim();
      if (!title) throw new Error("Требуется имя");
      const key = agent.labels?.["kanban.key"] || /^([A-Z]+-\d+(?:-\d+)*): /.exec(agent.title || "")?.[1];
      await client.updateAgent(agent.id, { name: key ? `${key}: ${(title.startsWith(`${key}:`) ? title.slice(key.length + 1).trimStart() : title)}` : title, labels: agent.labels });
    }
    if (input.action === "reload") {
      const native = client as typeof client & { refreshAgent(id: string): Promise<unknown> };
      if (typeof native.refreshAgent !== "function") throw new Error("Перезагрузка недоступна");
      await native.refreshAgent(agent.id);
    }
    if (input.action === "restore") {
      if (!agent.persistence?.sessionId || !agent.workspaceId) throw new Error("Сессия недоступна");
      const restored = await client.importAgent({ provider: agent.provider, sessionId: agent.persistence.sessionId, cwd: agent.cwd, workspaceId: agent.workspaceId, labels: agent.labels });
      if (restored.id !== agent.id || restored.workspaceId !== agent.workspaceId)
        throw new Error("Paseo изменил контракт импорта");
      await client.updateAgent(agent.id, { name: agent.title ?? undefined, labels: agent.labels });
    }
    if (input.action === "archive") {
      const stamp = new Date().toISOString();
      const children = await descendants(client, agent.id);
      for (const item of [agent, ...children.filter(a => !a.archivedAt && a.workspaceId === agent.workspaceId)])
        await client.updateAgent(item.id, { labels: { ...item.labels, "paseo.explicit-archive-at": stamp } });
      await client.archiveAgent(agent.id);
    }
    return {};
}

// Extended only after the isolated archive/import/rollback gate.
const testedVersions = new Set(["0.12.0", "0.13.2"]);

export async function connectTransferClient(instance: unknown, serverId: string): Promise<TransferClient> {
  const connection = instance as TransferClient & {
    connect(): Promise<void>;
    getDaemonStatus(): Promise<{ serverId: string; version: string }>;
  };
  if (!supported(connection) || typeof connection.connect !== "function" ||
      typeof connection.getDaemonStatus !== "function") throw new Error(unavailable);
  await connection.connect();
  const status = await connection.getDaemonStatus();
  if (!serverId || status.serverId !== serverId || !testedVersions.has(status.version))
    throw new Error(unavailable);
  return connection;
}
