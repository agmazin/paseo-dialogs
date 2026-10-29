import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { executeDialogAction } from "../server/transfer.ts";

test("dialog archive uses the host SDK for snapshots, pagination and native archive", async () => {
  const calls: string[] = [];
  const root = { id: "root", workspaceId: "w", labels: { keep: "yes" } };
  const privateClient = {
    updateAgent: async () => { calls.push("metadata"); },
    archiveAgent: async () => { throw new Error("private archive must not be used"); },
    close: async () => { calls.push("close"); },
  };
  const paseo = { agents: {
    ref: () => ({ refresh: async () => ({ agent: root }), archive: async () => { calls.push("native archive"); } }),
    list: async () => ({ entries: [], pageInfo: {} }),
  } };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(new URL("../server/dialog-action.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "require", code)(exports, (id: string) => {
    if (id === "./transfer-client") return { transferClient: async () => privateClient };
    if (id === "./transfer") return { executeDialogAction };
    if (id === "node:os") return { homedir: () => "/unused" };
    if (id === "node:path") return { join: (...parts: string[]) => parts.join("/") };
    throw new Error(id);
  });
  await exports.handleDialogAction({ agentId: "root", action: "archive" }, paseo);
  assert.deepEqual(calls, ["metadata", "native archive", "close"]);
  calls.length = 0;
  paseo.agents.ref = () => ({ refresh: async () => { throw new Error("offline"); }, archive: async () => {} });
  await assert.rejects(exports.handleDialogAction({ agentId: "root", action: "archive" }, paseo), /offline/);
  assert.deepEqual(calls, ["close"]);
});
