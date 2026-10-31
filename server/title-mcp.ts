import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const home = process.env.PASEO_HOME;
const token = process.env.PASEO_DIALOGS_TITLE_TOKEN;
if (!home || !token) throw new Error("self_title_scope_missing");
const lines = createInterface({ input: process.stdin });
let client: DaemonClient | undefined;
const tool = {
  name: "name_this_chat",
  description: "Обязательное первое действие: назови СВОЙ чат по первому запросу пользователя. Чужой чат выбрать нельзя. Сохраняет ручное имя, архив и номер Канбана. Повторный вызов безопасен.",
  inputSchema: { type: "object", properties: { title: { type: "string", maxLength: 24 } }, required: ["title"], additionalProperties: false },
};
for await (const line of lines) {
  let message;
  try { message = JSON.parse(line); } catch { continue; }
  if (message.id === undefined) continue;
  try {
    let result;
    if (message.method === "initialize") result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "dialogs-title", version: "0.11.0" } };
    else if (message.method === "ping") result = {};
    else if (message.method === "tools/list") result = { tools: [tool] };
    else if (message.method === "tools/call") {
      if (message.params.name !== tool.name || typeof message.params.arguments?.title !== "string" || Object.keys(message.params.arguments).some(key => key !== "title"))
        throw new Error("self_title_invalid_arguments");
      try {
        if (!client) {
          const pid = JSON.parse(await readFile(join(home, "paseo.pid"), "utf8"));
          if (!/^(127\.0\.0\.1|localhost):\d+$/.test(pid.listen)) throw new Error("self_title_local_daemon_required");
          client = new DaemonClient({ url: `ws://${pid.listen}/ws`, clientId: `dialogs-title-${randomUUID()}`, clientType: "cli",
            logger: { debug() {}, info() {}, warn() {}, error() {} },
            localCredential: async () => (await readFile(join(home, "local-credential"), "utf8")).trim(), reconnect: { enabled: false } });
          await client.connect();
        }
        const response = await client.invokePluginRpc(process.env.PASEO_DIALOGS_PLUGIN_ID || "paseo-dialogs", "dialogs.self-title", { token, title: message.params.arguments.title });
        result = { content: [{ type: "text", text: JSON.stringify(response) }] };
      } catch (error) {
        await client?.close().catch(() => {});
        client = undefined;
        result = { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "self_title_failed" }] };
      }
    } else { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }) + "\n"); continue; }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Invalid request" } }) + "\n");
  }
}
await client?.close();
