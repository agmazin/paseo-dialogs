export interface StatusAgent {
  status: string;
  pendingPermissions?: unknown[];
  pendingPermissionCount?: number;
  attentionReason?: string | null;
  requiresAttention?: boolean;
}
export function bucket(a: StatusAgent, unread?: boolean) {
  if (
    (a.pendingPermissionCount ?? a.pendingPermissions?.length ?? 0) > 0 ||
    a.attentionReason === "permission"
  )
    return "needs_input";
  if (a.status === "error" || a.attentionReason === "error") return "failed";
  if (a.status === "running") return "running";
  if (unread ?? a.requiresAttention) return "attention";
  return "done";
}
export function topLevel(a: {
  parentAgentId?: string | null;
  labels?: Readonly<Record<string, string>>;
}) {
  return !a.parentAgentId && !a.labels?.["paseo.parent-agent-id"];
}
// A subagent shown under its parent: only while it works and is not archived.
export function runningSubagent(a: {
  status: string;
  archivedAt?: string | null;
  parentAgentId?: string | null;
  labels?: Readonly<Record<string, string>>;
}) {
  return !topLevel(a) && a.status === "running" && !a.archivedAt;
}
// A dialog whose own badge may give way to its working subagents (not permission or error).
export function atRest(status: string) {
  return status === "done" || status === "attention";
}
// Running subagents by parent id; parentAgentId of slim rows already includes the label.
export function runningByParent<T extends { status: string; archivedAt?: string | null; parentAgentId?: string | null }>(
  agents: readonly T[],
) {
  const kids = new Map<string, T[]>();
  for (const a of agents)
    if (a.parentAgentId && runningSubagent(a)) kids.set(a.parentAgentId, [...(kids.get(a.parentAgentId) ?? []), a]);
  return kids;
}
export function titleWithoutKey(title: string | null | undefined, key?: string) {
  const text = title?.trim() ?? "";
  return key && text.startsWith(`${key}: `) ? text.slice(key.length + 2) : text;
}
export function autoTitle(title: string | null | undefined, prompt: string, key?: string) {
  const text = titleWithoutKey(title, key);
  return !text || text === prompt.trim().slice(0, 60);
}
export function replacementTitle(current: FullAgent, previous: FullAgent, prompt: string, title: string) {
  const key = current.labels?.["kanban.key"];
  if (current.archivedAt || !topLevel(current) ||
      !autoTitle(current.title, prompt, key) ||
      titleWithoutKey(current.title, key) !== titleWithoutKey(previous.title, previous.labels?.["kanban.key"])) return null;
  return key ? `${key}: ${title}` : title;
}
export function validTitle(text: string) {
  const t = text.trim();
  return t.length <= 24 && /^[А-ЯЁ][а-яё]+(?: [А-ЯЁа-яё]+)?$/.test(t)
    ? t
    : null;
}
export function activityTime(date: string, now = new Date()) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return "";
  if (now.getTime() - d.getTime() < 120_000) return "сейчас";
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "вчера";
  return `${d.getDate()} ${["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][d.getMonth()]}`;
}

export interface FullAgent {
  id: string;
  title?: string | null;
  provider: string;
  model?: string | null;
  currentModeId?: string | null;
  thinkingOptionId?: string | null;
  status: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  lastUserMessageAt?: string | null;
  lastActivityAt?: string | null;
  attentionTimestamp?: string | null;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  pendingPermissions?: readonly unknown[] | null;
  activeTurn?: unknown;
  parentAgentId?: string | null;
  labels?: Readonly<Record<string, string>>;
}
// The latest of several ISO times (all UTC "Z", so they compare as strings).
export function latest(...times: (string | null | undefined)[]) {
  let best: string | null = null;
  for (const t of times) if (t && (!best || t > best)) best = t;
  return best;
}

// Paseo moves updatedAt (and the lastActivityAt shown to clients) on renames and labels too, so
// Kanban numbering made every renamed dialog look active at the same minute. Real activity is
// Alexander's last message and the end of the agent's last turn; the server adds turn times it saw.
export function realActivity(a: FullAgent) {
  return latest(a.lastUserMessageAt, a.attentionTimestamp);
}

export function slim(a: FullAgent) {
  return {
    id: a.id,
    title: a.title ?? null,
    provider: a.provider,
    model: a.model ?? null,
    currentModeId: a.currentModeId ?? null,
    thinkingOptionId: a.thinkingOptionId ?? null,
    status: a.status,
    workspaceId: a.workspaceId ?? null,
    archivedAt: a.archivedAt ?? null,
    createdAt: a.createdAt,
    lastUserMessageAt: a.lastUserMessageAt ?? null,
    lastActivityAt: realActivity(a),
    requiresAttention: !!a.requiresAttention,
    attentionReason: a.attentionReason ?? null,
    pendingPermissionCount: a.pendingPermissions?.length ?? 0,
    activeTurn: !!a.activeTurn,
    parentAgentId: a.parentAgentId || a.labels?.["paseo.parent-agent-id"] || null,
  };
}

// "AGM-1: Paseo Канбан": the number the Kanban plugin puts before a chat title.
export function splitKey(title: string) {
  const m = /^([A-Z]{3}-\d+(?:-\d+)*): (\S.*)$/.exec(title);
  return m ? { key: m[1], name: m[2] } : { key: null, name: title };
}
