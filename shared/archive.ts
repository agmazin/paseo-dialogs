export interface ArchiveAgent {
  id: string;
  workspaceId?: string | null;
  status: string;
  archivedAt?: string | null;
  parentAgentId?: string | null;
  labels?: Readonly<Record<string, string>>;
}

export function archiveImpact(agent: ArchiveAgent, records: readonly ArchiveAgent[]) {
  const active = records.filter(a => !a.archivedAt);
  const descendants = new Set([agent.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const child of active) {
      const parent = child.parentAgentId || child.labels?.["paseo.parent-agent-id"];
      if (!parent || !descendants.has(parent) || descendants.has(child.id)) continue;
      descendants.add(child.id);
      changed = true;
    }
  }
  return {
    children: active.filter(a => a.id !== agent.id && descendants.has(a.id) && a.workspaceId === agent.workspaceId).length,
    working: active.some(a => descendants.has(a.id) && ["running", "initializing"].includes(a.status)),
  };
}
