import type { PluginServerContext } from "@getpaseo/plugin/server";
import { register } from "./server/runtime";
import { displaySettings } from "./shared/settings";
export default function contribute(server: PluginServerContext) {
  server.registerSettings(displaySettings);
  return register(server);
}
