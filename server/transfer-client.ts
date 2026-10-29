import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { connectTransferClient, unavailable, type TransferClient } from "./transfer";

// Explicitly approved private adapter. Resolve at runtime so missing internal
// exports disable only transfer instead of breaking the whole plugin bundle.
export async function transferClient(home: string): Promise<TransferClient> {
  let client: TransferClient | undefined;
  let stage = "daemon";
  try {
    const pid = JSON.parse(await readFile(join(home, "paseo.pid"), "utf8"));
    const serverId = (await readFile(join(home, "server-id"), "utf8")).trim();
    // Only connect to this plugin server's local daemon. No default-home fallback.
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(pid.listen)) throw new Error("listen");
    stage = "module";
    const config = JSON.parse(await readFile(join(home, "config.json"), "utf8"));
    const pluginPath = config.plugins?.["paseo-dialogs"]?.path;
    if (typeof pluginPath !== "string" || !isAbsolute(pluginPath)) throw new Error("plugin path");
    const require = createRequire(join(pluginPath, "package.json"));
    const entry = require.resolve("@getpaseo/client/internal/daemon-client");
    const module = await import(pathToFileURL(entry).href);
    if (typeof module.DaemonClient !== "function") throw new Error("module");
    const instance = new module.DaemonClient({
      url: `ws://${pid.listen}/ws`, clientId: `paseo-dialogs-transfer-${randomUUID()}`, clientType: "cli",
      localCredential: async () => (await readFile(join(home, "local-credential"), "utf8")).trim(),
      reconnect: { enabled: false }, connectTimeoutMs: 5000,
    });
    client = instance;
    stage = "contract";
    await connectTransferClient(instance, serverId);
    return instance;
  } catch (error) {
    console.error("Диалоги: перенос недоступен", stage, (error as { code?: string }).code ?? "unknown");
    if (typeof client?.close === "function") await client.close().catch(() => {});
    throw new Error(unavailable);
  }
}
