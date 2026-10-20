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
  labels?: Record<string, string>;
}) {
  return !a.parentAgentId && !a.labels?.["paseo.parent-agent-id"];
}
export function autoTitle(title: string | null | undefined, prompt: string) {
  return !title?.trim() || title.trim() === prompt.trim().slice(0, 60);
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
