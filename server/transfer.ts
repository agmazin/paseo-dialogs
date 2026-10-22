import type { PaseoAgent } from "@getpaseo/client";

export const unavailable = "Перенос недоступен в этой версии Paseo. Данные не изменены.";
export type TransferClient = {
  fetchAgent(id: string): Promise<{ agent: PaseoAgent } | null>;
  archiveAgent(id: string): Promise<unknown>;
  importAgent(input: { provider: string; sessionId: string; cwd: string; workspaceId: string; labels: Record<string, string> }): Promise<PaseoAgent>;
  updateAgent(id: string, input: { name?: string; labels: Record<string, string> }): Promise<unknown>;
  close(): Promise<void>;
};
export function supported(client: unknown): client is TransferClient {
  return !!client && ["fetchAgent", "archiveAgent", "importAgent", "updateAgent", "close"]
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

// Same-ID archive/import is the tested Paseo 0.12 contract. Never delete a session.
export async function transfer(client: TransferClient, input: {
  agentId: string; sourceId: string; targetId: string;
}, hooks: {
  before: (agent: PaseoAgent) => Promise<void>;
  restore: (agent: PaseoAgent) => Promise<void>;
}) {
  if (!supported(client)) throw new Error(unavailable);
  const a = (await client.fetchAgent(input.agentId))?.agent;
  if (!a || a.workspaceId !== input.sourceId) throw new Error("Диалог уже перемещён. Обновите список.");
  if (input.sourceId === input.targetId) throw new Error("Выберите другую папку");
  const problem = transferProblem(a);
  if (problem) throw new Error(problem);
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
  await hooks.before(a); // Persist recovery details before the first mutation.
  try {
    // Recheck after disk work so a newly started turn is not interrupted.
    const latest = (await client.fetchAgent(a.id))?.agent;
    if (!latest || latest.workspaceId !== a.workspaceId || transferProblem(latest))
      throw new Error("Перенести можно, когда агент закончит");
    await client.archiveAgent(a.id);
    const moved = await restore(input.targetId);
    return { agentId: moved.id, workspaceId: input.targetId, archived: false };
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
    } catch {
      throw new Error(`Перенос и откат не завершены. Сессия ${a.provider}: ${request.sessionId}. Исходная папка: ${input.sourceId}. Нужна помощь оркестратора.`);
    }
    throw new Error("Перенос не выполнен. Диалог восстановлен в исходной папке.");
  }
}
