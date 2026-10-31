import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { sidebarRuntime } from "../helpers/sidebar-runtime.mts";

const baseline = process.env.PASEO_BASELINE_RUNTIME;
assert.ok(baseline, "PASEO_BASELINE_RUNTIME must name the saved 0.11.0 runtime source");
const results: any[] = [];
for (const [version, source] of [["before-0.11.0", await readFile(baseline, "utf8")], ["after", undefined]]) {
  const app = await sidebarRuntime({ source, unread: { never: "fixture-token" }, read: () => new Promise(() => {}) });
  let ready = false;
  let latency: number | null = null;
  const start = performance.now();
  const request = app.call("state").then(() => { ready = true; latency = performance.now() - start; });
  await Promise.race([request, new Promise((resolve) => setTimeout(resolve, 100))]);
  const readyBeforeHistory = ready;
  if (version === "after") {
    assert.ok(readyBeforeHistory, "A never-resolving history must not block initial state");
    assert.deepEqual((await app.call("agents", { archives: [], limit: 30 })).agents, []);
  } else assert.equal(readyBeforeHistory, false, "Baseline must reproduce the blocking state");
  results.push({ version, history: "never-resolving fixture", readyBeforeHistory, initialMs: latency,
    observedPendingMs: readyBeforeHistory ? null : 100, timelineRequests: app.reads });
  await app.close();
}
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/sidebar-readiness.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
