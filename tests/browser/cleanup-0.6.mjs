// Archives the 0.6.0 test groups left by an interrupted run on the isolated daemon.
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
const names = new Set(["Удаление пустая", "Удаление два диалога", "Перенос цель", "Переименовано"]);
const c = new DaemonClient({ url: "ws://127.0.0.1:6782/ws", clientId: "dialogs-060-cleanup", clientType: "cli" });
await c.connect();
try {
  const list = await c.fetchWorkspaces();
  for (const w of list.entries ?? list.workspaces ?? []) {
    if (!names.has(w.name) || w.archivingAt) continue;
    console.log("archive", w.id, w.name, (await c.archiveWorkspace(w.id)).error ?? "ok");
  }
} finally { await c.close(); }
