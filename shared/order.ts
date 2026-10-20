// Preserve surviving IDs, append newly visible workspaces, discard duplicates.
export function reconcileOrder(saved: readonly string[], active: readonly string[]) {
  const visible = new Set(active);
  return [...new Set([...saved.filter(id => visible.has(id)), ...active])];
}

// A move operation preserves concurrent additions and other clients' changes.
export function moveGroup(order: readonly string[], id: string, beforeId: string | null) {
  if (!order.includes(id) || beforeId === id || (beforeId !== null && !order.includes(beforeId))) return [...order];
  const next = order.filter(key => key !== id);
  next.splice(beforeId === null ? next.length : next.indexOf(beforeId), 0, id);
  return next;
}
