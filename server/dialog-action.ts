import type { PaseoApi } from "@getpaseo/client";
import { homedir } from "node:os";
import { join } from "node:path";
import { dialogClient } from "./transfer-client";
import { executeDialogAction } from "./transfer";

export async function handleDialogAction(input: { agentId: string; action: string; title?: string }, paseo: PaseoApi) {
  const methods: Record<string, string[]> = { archive: ["updateAgent"], rename: ["updateAgent"], reload: ["refreshAgent"], restore: ["importAgent", "updateAgent"], resume: [] };
  const client = await dialogClient(process.env.PASEO_HOME || join(homedir(), ".paseo"), methods[input.action] ?? []);
  try {
    return await executeDialogAction({
      fetchAgent: id => paseo.agents.ref(id).refresh(),
      fetchAgents: options => paseo.agents.list(options),
      archiveAgent: id => paseo.agents.ref(id).archive(),
      updateAgent: (id, value) => client.updateAgent(id, value),
      importAgent: value => client.importAgent(value),
      refreshAgent: id => {
        const native = client as typeof client & { refreshAgent(id: string): Promise<unknown> };
        if (typeof native.refreshAgent !== "function") throw new Error("Перезагрузка недоступна");
        return native.refreshAgent(id);
      },
      close: async () => {},
    }, input);
  }
  finally { await client.close(); }
}

