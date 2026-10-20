import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
export const markerSchema = z.object({
  agentId: z.string(),
  token: z.string(),
});
export const stateSchema = z.object({
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
