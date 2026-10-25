import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveImpact } from "../shared/archive.ts";
test("archive impact counts descendants in the workspace and warns about working descendants", () => {
  const root = { id: "r", workspaceId: "w", status: "idle" };
  const records = [root,
    { id: "c", workspaceId: "w", status: "idle", labels: { "paseo.parent-agent-id": "r" } },
    { id: "g", workspaceId: "w", status: "running", parentAgentId: "c" },
    { id: "other", workspaceId: "another", status: "idle", parentAgentId: "r" },
    { id: "archived", workspaceId: "w", status: "idle", parentAgentId: "r", archivedAt: "date" },
  ];
  assert.deepEqual(archiveImpact(root, records), { children: 2, working: true });
  assert.deepEqual(archiveImpact(root, [root]), { children: 0, working: false });
  assert.deepEqual(archiveImpact({ ...root, status: "running" }, [{ ...root, status: "running" }]), { children: 0, working: true });
});
