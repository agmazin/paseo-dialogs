import { defineSettings, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

export const displaySettings = defineSettings({
  id: "display",
  scope: "host",
  version: 1,
  schema: z.object({ showNativeWorkspaces: z.boolean().default(false) }),
});

export const sidebarVisibility = typeof defineSubscription === "function" ? defineSubscription({
  name: "dialogs.sidebar-visibility",
  input: z.object({}),
  event: z.object({
    host: z.object({ id: z.string(), label: z.string() }),
    showNativeWorkspaces: z.boolean(),
  }),
}) : undefined;
