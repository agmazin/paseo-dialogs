import { test } from "node:test";
import assert from "node:assert/strict";
import { connectTransferClient } from "../server/transfer.ts";

function fixture(version = "0.13.2", serverId = "local") {
  const calls: string[] = [];
  const mutation = async () => { calls.push("mutation"); };
  const client: any = {
    connect: async () => { calls.push("connect"); },
    getDaemonStatus: async () => { calls.push("status"); return { version, serverId }; },
    fetchAgents: async () => {}, fetchAgent: async () => {}, archiveAgent: mutation,
    importAgent: mutation, updateAgent: mutation, close: async () => {},
  };
  return { client, calls };
}
test("private contract accepts only tested versions and the expected local server", async () => {
  for (const version of ["0.12.0", "0.13.2"]) {
    const f = fixture(version);
    assert.equal(await connectTransferClient(f.client, "local"), f.client);
    assert.deepEqual(f.calls, ["connect", "status"]);
  }
});
test("unknown versions and wrong or empty server identity fail before mutations", async () => {
  for (const [version, actual, expected] of [
    ["0.13.3", "local", "local"], ["0.14.0", "local", "local"],
    ["0.13.2", "other", "local"], ["0.13.2", "local", ""],
  ]) {
    const f = fixture(version, actual);
    await assert.rejects(connectTransferClient(f.client, expected), /Данные не изменены/);
    assert.deepEqual(f.calls, ["connect", "status"]);
  }
});
test("missing private methods fail before connecting or mutating", async () => {
  for (const key of ["fetchAgents", "fetchAgent", "archiveAgent", "importAgent", "updateAgent", "close", "connect", "getDaemonStatus"]) {
    const f = fixture(); delete f.client[key];
    await assert.rejects(connectTransferClient(f.client, "local"), /Данные не изменены/);
    assert.deepEqual(f.calls, []);
  }
});
