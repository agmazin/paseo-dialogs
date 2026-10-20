import type { PluginServerContext } from "@getpaseo/plugin/server";
import { register } from "./server/runtime";
export default function contribute(server: PluginServerContext) {
  return register(server);
}
