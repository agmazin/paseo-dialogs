import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";

assert.equal(process.env.PASEO_VERIFY_PRODUCTION_READONLY, "1", "Explicit read-only production opt-in required");
const home = "/Users/agmazin/.paseo";
const pid = JSON.parse(await readFile(join(home, "paseo.pid"), "utf8"));
assert.equal(pid.listen, "127.0.0.1:6767");
const client = new DaemonClient({ url: `ws://${pid.listen}/ws`, clientId: "dialogs-readonly-production-verify", clientType: "mobile",
  appVersion: "0.13.2", localCredential: () => readFile(join(home, "local-credential"), "utf8").then((text) => text.trim()),
  reconnect: { enabled: false } });
const sourceText = (source: string) => source.replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
try {
  await client.connect();
  const status = await client.getDaemonStatus();
  assert.equal(status.version, "0.13.2");
  const manifest = JSON.parse(await readFile("/Users/agmazin/Library/Developer/paseo-releases/paseo-dialogs/paseo-plugin.json", "utf8"));
  assert.equal(manifest.version, "0.11.1");
  const plugin = (await client.listPlugins()).find((item) => item.id === "paseo-dialogs");
  assert.equal(plugin?.status, "running");
  const entry = (await client.getPluginCatalog()).find((item) => item.id === "paseo-dialogs");
  assert.ok(entry);
  const source = sourceText(entry.clientBundle);
  for (const label of ["Загружаем список диалогов", "Повторить загрузку диалогов", "Подключаемся к серверу диалогов"])
    assert.ok(source.includes(label));
  assert.equal(entry.requirements?.paseo, ">=0.13.2");
  const start = performance.now();
  const state: any = await client.invokePluginRpc("paseo-dialogs", "dialogs.state", {});
  const initialStateMs = performance.now() - start;
  assert.ok(Array.isArray(state.groupOrder));
  const agentsStart = performance.now();
  const agents: any = await client.invokePluginRpc("paseo-dialogs", "dialogs.agents", { archives: [], limit: 0 });
  const agentsMs = performance.now() - agentsStart;
  assert.ok(Array.isArray(agents.agents));
  const workspacesStart = performance.now();
  const workspaces = await client.fetchWorkspaces({ page: { limit: 1 } });
  const workspacesMs = performance.now() - workspacesStart;
  assert.ok(Array.isArray(workspaces.entries));
  const result = { verifiedAt: new Date().toISOString(), release: manifest.version, daemon: status.version,
    clientHandshake: "mobile/0.13.2 (SDK fixture, not physical Android)", pluginStatus: plugin.status,
    requirements: entry.requirements.paseo, bundleBytes: Buffer.byteLength(entry.clientBundle),
    bundleSha256: createHash("sha256").update(entry.clientBundle).digest("hex"),
    initialStateMs, restorationPendingAtRead: state.restoring === true,
    agentsAccessible: true, agentsMs, workspacesAccessible: true, workspacesMs,
    mutations: "No install/reload/title/archive/tab/agent operations; ordinary dialogs.state read only",
    limitation: "No physical Android UI, relay latency or FPS measurement" };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/production-mobile-readonly.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await client.close(); }
