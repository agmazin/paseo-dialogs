import type { PluginServerContext } from "@getpaseo/plugin/server";
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, win32 } from "node:path";
import { firstPrompt } from "./first-prompt";
import { autoTitle, splitKey, topLevel, validTitle } from "../shared/model";
import { transferClient } from "./transfer-client";

export const selfTitle = defineRpc({
  name: "dialogs.self-title",
  input: z.object({ token: z.string().uuid(), title: z.string().min(1).max(24) }).strict(),
  output: z.object({ status: z.enum(["renamed", "unchanged", "preserved"]), title: z.string().nullable() }),
});
const marker = "[paseo-dialogs:self-title:v1]";
export const instruction = `${marker}
До ответа пользователю и любых других инструментов первым действием вызови MCP-инструмент name_this_chat.
Сам выбери короткое содержательное название по ПЕРВОМУ запросу пользователя: 1-2 русских слова, максимум 24 символа, без кавычек и точки. Номер Канбана не передавай: инструмент сохранит его сам.
Это обязательное служебное действие, даже если запрос не требует инструментов. При временной ошибке повтори вызов (не более трёх раз). Продолжай основную задачу после подтверждения renamed, unchanged или preserved. Ручное название и архив инструмент сохраняет. После переподключения повторный вызов безопасен. Не создавай другой чат и не вызывай другую модель для названия.`;

type Candidate = { token: string; baseline?: string | null; applied?: string; done?: boolean };
export function registerSelfTitle(server: PluginServerContext, options: { pluginId?: string; cwd?: string } = {}) {
  const pluginId = options.pluginId || "paseo-dialogs";
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  const directory = join(home, "plugin-data", pluginId);
  const path = join(directory, "self-titles.json");
  let records: Record<string, Candidate> = {};
  const ready = (async () => {
    try {
      records = z.record(z.string(), z.object({
        token: z.string().uuid(), baseline: z.string().nullable().optional(),
        applied: z.string().optional(), done: z.boolean().optional(),
      }).strict()).parse(JSON.parse(await readFile(path, "utf8")));
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  })();
  let queue = Promise.resolve();
  const serial = <T,>(operation: () => Promise<T>) => {
    const result = queue.then(operation);
    queue = result.then(() => {}, () => {});
    return result;
  };
  const save = async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, JSON.stringify(records), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  };
  const offCreate = server.before("agent.create", async ({ request }) => {
    if (request.config.internal || (options.cwd && request.config.cwd !== options.cwd)) return;
    if (request.config.systemPrompt?.includes(marker)) return;
    const config = JSON.parse(await readFile(join(home, "config.json"), "utf8"));
    const pluginPath = config.plugins?.[pluginId]?.path;
    if (typeof pluginPath !== "string" || !pluginPath.startsWith("/")) throw new Error("self_title_plugin_path_unavailable");
    if (request.config.mcpServers?.dialogs_title) throw new Error("self_title_mcp_name_conflict");
    const token = randomUUID();
    await ready;
    await serial(async () => {
      records[`pending:${token}`] = { token, baseline: request.config.title ?? null };
      await save();
    });
    return {
      ...request,
      env: { ...request.env },
      config: {
        ...request.config,
        systemPrompt: [request.config.systemPrompt, instruction].filter(Boolean).join("\n\n"),
        mcpServers: {
          ...request.config.mcpServers,
          dialogs_title: {
            type: "stdio" as const,
            command: process.env.PASEO_DIALOGS_NODE || "node",
            args: ["--experimental-strip-types", join(pluginPath, "server", "title-mcp.ts")],
            env: { PASEO_HOME: home, PASEO_DIALOGS_TITLE_TOKEN: token, PASEO_DIALOGS_PLUGIN_ID: pluginId },
            alwaysLoad: true,
          },
        },
        toolPolicy: {
          ...request.config.toolPolicy,
          preapproved: [...(request.config.toolPolicy?.preapproved ?? []), { kind: "mcp" as const, server: "dialogs_title", tool: "name_this_chat" }],
        },
      },
    };
  });
  const offCreated = server.on("agent.created", async ({ agent }) => {
    if (options.cwd && agent.cwd !== options.cwd) return;
    await ready;
    await serial(async () => {
      if (records[agent.id]) return;
      if (!/^[a-f0-9-]{36}$/.test(agent.id)) throw new Error("self_title_invalid_agent_id");
      const { root } = win32.parse(agent.cwd);
      const body = agent.cwd.slice(root.length).replace(/[\\/]+$/, "");
      const prefix = root.replace(/[:\\/]+/g, "-").replace(/^-+|-+$/g, "");
      const slug = body ? (prefix ? `${prefix}-` : "") + body.replace(/[\\/]+/g, "-") : prefix || "root";
      const stored = JSON.parse(await readFile(join(home, "agents", slug, `${agent.id}.json`), "utf8"));
      if (stored.id !== agent.id || stored.cwd !== agent.cwd) throw new Error("self_title_binding_schema_mismatch");
      const token = stored.config?.mcpServers?.dialogs_title?.env?.PASEO_DIALOGS_TITLE_TOKEN;
      if (typeof token !== "string") return;
      const pending = records[`pending:${token}`];
      if (!pending || pending.token !== token || !stored.config?.systemPrompt?.includes(marker)) return;
      records[agent.id] = pending;
      delete records[`pending:${token}`];
      await save();
    });
  });
  server.handle(selfTitle, async ({ token, title }, { paseo }) => {
    await ready;
    return serial(async () => {
      const match = Object.entries(records).find(([, record]) => {
        const a = Buffer.from(record.token);
        const b = Buffer.from(token);
        return a.length === b.length && timingSafeEqual(a, b);
      });
      if (!match) throw new Error("self_title_scope_denied");
      const [agentId, record] = match;
      if (agentId.startsWith("pending:")) throw new Error("self_title_binding_pending: повтори вызов");
      const handle = paseo.agents.ref(agentId);
      const current = await handle.refresh();
      if (!current) throw new Error("self_title_agent_unavailable");
      if (record.done) return { status: "unchanged" as const, title: current.agent.title ?? null };
      const prompt = await firstPrompt(handle.timeline);
      if (!prompt) throw new Error("self_title_first_prompt_unavailable");
      const workspace = current.agent.workspaceId ? await paseo.workspaces.ref(current.agent.workspaceId).refresh() : null;
      const preserve = async (name: string | null | undefined) => {
        record.done = true;
        await save();
        return { status: "preserved" as const, title: name ?? null };
      };
      const keyOf = (agent: typeof current.agent) => agent.labels?.["kanban.key"] || splitKey(agent.title ?? "").key || undefined;
      if (!workspace || workspace.background || workspace.archivingAt || current.agent.archivedAt || !topLevel(current.agent))
        return preserve(current.agent.title);
      const key = keyOf(current.agent);
      const body = splitKey(current.agent.title ?? "").name;
      if (record.applied && body === record.applied) {
        record.done = true;
        await save();
        return { status: "unchanged" as const, title: current.agent.title ?? null };
      }
      if (!autoTitle(current.agent.title, prompt, key) ||
          (record.baseline !== undefined && !autoTitle(record.baseline, prompt, splitKey(record.baseline ?? "").key || undefined)))
        return preserve(current.agent.title);
      const valid = validTitle(title);
      if (!valid) throw new Error("self_title_invalid_title: нужны 1-2 русских слова, максимум 24 символа");
      record.applied ??= valid;
      await save();
      const client = await transferClient(home);
      try {
        // Refresh after connecting: neither a manual edit nor a new Kanban number may be stale.
        const latest = await handle.refresh();
        if (!latest) throw new Error("self_title_agent_unavailable");
        if (latest.agent.archivedAt || !topLevel(latest.agent) || !autoTitle(latest.agent.title, prompt, keyOf(latest.agent)))
          return preserve(latest.agent.title);
        const latestKey = keyOf(latest.agent);
        const name = latestKey ? `${latestKey}: ${record.applied}` : record.applied;
        await client.updateAgent(agentId, { name, labels: {} });
        const verified = await handle.refresh();
        if (!verified || verified.agent.title !== name) throw new Error("self_title_verification_failed");
        record.done = true;
        await save();
        console.log("Диалоги: агент назвал свой чат", agentId);
        return { status: "renamed" as const, title: name };
      } finally { await client.close(); }
    });
  });
  return async () => { offCreate(); offCreated(); await queue; };
}
