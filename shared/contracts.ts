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
