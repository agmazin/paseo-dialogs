import type { PluginServerContext } from "@getpaseo/plugin/server";

export default function contribute(_server: PluginServerContext) {
  console.log("Диалоги: спайк запущен");
  return () => {};
}
