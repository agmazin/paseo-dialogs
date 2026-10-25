import { homedir } from "node:os";
import { join } from "node:path";
import { transferClient } from "./transfer-client";
import { executeDialogAction } from "./transfer";

export async function handleDialogAction(input: { agentId: string; action: string; title?: string }) {
  const client = await transferClient(process.env.PASEO_HOME || join(homedir(), ".paseo"));
  try { return await executeDialogAction(client, input); }
  finally { await client.close(); }
}

