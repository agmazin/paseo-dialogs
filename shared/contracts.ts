import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
export const markerSchema = z.object({
  agentId: z.string(),
  token: z.string(),
});
export const stateSchema = z.object({
  groupOrder: z.array(z.string()).default([]),
  collapsed: z.record(z.string(), z.boolean()),
  archives: z.record(z.string(), z.boolean()),
  unread: z.record(z.string(), z.string()),
});
export const readState = defineRpc({
  name: "dialogs.state",
  input: z.object({}),
  output: stateSchema,
});
export const preference = defineRpc({
  name: "dialogs.preference",
  input: z.object({
    section: z.enum(["collapsed", "archives"]),
    id: z.string(),
    value: z.boolean(),
  }),
  output: stateSchema,
});
export const markRead = defineRpc({
  name: "dialogs.read",
  input: markerSchema,
  output: z.object({}),
});
export const ROOT = "/Users/agmazin/Yandex.Disk.localized/public";
export const claimAction = defineRpc({
  name: "dialogs.claim-action",
  input: z.object({ token: z.string().min(1) }),
  output: z.object({ claimed: z.boolean() }),
});

export const reorderGroups = defineRpc({
  name: "dialogs.reorder-groups",
  input: z.object({ id: z.string().min(1), beforeId: z.string().min(1).nullable() }),
  output: stateSchema,
});
export const moveDialog = defineRpc({
  name: "dialogs.move",
  input: z.object({ agentId: z.string().min(1), sourceId: z.string().min(1), targetId: z.string().min(1) }),
  output: z.object({ agentId: z.string(), workspaceId: z.string(), archived: z.boolean() }),
});

// Slim agent rows built on the daemon machine: the phone receives what the list needs
// (about 15 fields) instead of full snapshots (824 KB for 425 agents on 22.10.2026).
export const slimAgentSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  provider: z.string(),
  model: z.string().nullable(),
  currentModeId: z.string().nullable(),
  thinkingOptionId: z.string().nullable(),
  status: z.string(),
  workspaceId: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  lastUserMessageAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
  requiresAttention: z.boolean(),
  attentionReason: z.string().nullable(),
  pendingPermissionCount: z.number(),
  waitReason: z.enum(["permission", "ask", "review"]).nullable(),
  activeTurn: z.boolean(),
  parentAgentId: z.string().nullable(),
});
export type SlimAgent = z.output<typeof slimAgentSchema>;
// Live dialogs plus archive counts; archived rows only for groups whose "Архив" is open.
export const readAgents = defineRpc({
  name: "dialogs.agents",
  input: z.object({ archives: z.array(z.string()), limit: z.number().int().min(0).max(200) }),
  output: z.object({ agents: z.array(slimAgentSchema), archiveCounts: z.record(z.string(), z.number()) }),
});
export const readArchive = defineRpc({
  name: "dialogs.archive",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({ agents: z.array(slimAgentSchema) }),
});

export const dialogAction = defineRpc({
  name: "dialogs.action",
  input: z.object({ agentId: z.string().min(1), action: z.enum(["rename", "resume", "reload", "restore", "archive"]), title: z.string().optional() }),
  output: z.object({ text: z.string().optional() }),
});
