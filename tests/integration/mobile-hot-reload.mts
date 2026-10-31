import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const home = process.env.PASEO_TEST_HOME;
assert.ok(home, "PASEO_TEST_HOME is required; production is forbidden in this fixture");
const pid = JSON.parse(await readFile(join(home, "paseo.pid"), "utf8"));
assert.equal(pid.listen, "127.0.0.1:16816");
assert.notEqual(resolve(home), "/Users/agmazin/.paseo");
const client = new DaemonClient({ url: `ws://${pid.listen}/ws`, clientId: "dialogs-mobile-readiness-fixture", clientType: "mobile",
  appVersion: "0.13.2", localCredential: () => readFile(join(home, "local-credential"), "utf8").then((text) => text.trim()),
  reconnect: { enabled: false } });
const events: any[] = [];
const sourceText = (source: string) => source.replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
let observation: any;
try {
  await client.connect();
  const status = await client.getDaemonStatus();
  assert.equal(status.version, "0.14.0");
  const catalog = await client.getPluginCatalog();
  const first = catalog.find((item) => item.id === "paseo-dialogs");
  assert.ok(first && sourceText(first.clientBundle).includes("Загружаем список диалогов"));
  assert.ok(sourceText(first.clientBundle).includes("Повторить загрузку диалогов"));
  observation = client.observeEvents(["status.plugin_catalog_changed"]);
  observation.subscribe({ snapshot: () => {}, update: (message: any) => events.push(message) });
  const start = performance.now();
  const state: any = await client.invokePluginRpc("paseo-dialogs", "dialogs.state", {});
  assert.ok(Array.isArray(state.groupOrder));
  const initialMs = performance.now() - start;
  const final: any = await client.invokePluginRpc("paseo-dialogs", "dialogs.state", { waitForRestore: true });
  assert.equal(final.restoring, false);
  await client.reloadPlugin("paseo-dialogs");
  const deadline = Date.now() + 3000;
  while (!events.some((event) => event.payload?.pluginId === "paseo-dialogs") && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(events.some((event) => event.payload?.status === "plugin_catalog_changed" && event.payload?.pluginId === "paseo-dialogs"));
  const reloaded = (await client.getPluginCatalog()).find((item) => item.id === "paseo-dialogs");
  assert.ok(reloaded && sourceText(reloaded.clientBundle).includes("Подключаемся к серверу диалогов"));
  const result = { daemon: status.version, clientHandshake: "mobile/0.13.2", scope: "isolated daemon, no phone or LLM turn",
    initialMs, catalogEvents: events.length, bundleBytes: Buffer.byteLength(reloaded.clientBundle),
    sha256: createHash("sha256").update(reloaded.clientBundle).digest("hex"),
    reloadDelivered: true, host: pid.listen };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/mobile-hot-reload.json", JSON.stringify(result, null, 2));
  await writeFile("artifacts/isolated-client-catalog.json", JSON.stringify(await client.getPluginCatalog()));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await observation?.release();
  await client.close();
}
