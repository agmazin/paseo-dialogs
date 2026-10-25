import { copyText } from "@getpaseo/plugin/client/react-native";
import { Platform } from "react-native";
declare const window: any;
declare const document: any;
declare const fetch: any;
let layoutStore: any;
export async function discoverRowLayout() {
  if (Platform.OS !== "web" || typeof window.__r !== "function") return;
  for (const script of document.scripts) {
    if (!script.src?.includes("/static/js/")) continue;
    const source = await (await fetch(script.src)).text();
    for (const line of source.split("\n")) {
      if (!["hideAgent:", "unhideAgent:", "layoutByWorkspace", "closeTab:"].every(key => line.includes(key))) continue;
      const match = line.match(/\},(\d+),\[[\d,]*\]\);$/);
      if (!match) continue;
      for (const value of Object.values(window.__r(Number(match[1]))) as any[]) {
        const state = value?.getState?.();
        if (state?.layoutByWorkspace && ["hideAgent", "closeTab", "openTab", "unhideAgent"].every(key => typeof state[key] === "function")) { layoutStore = value; return; }
      }
    }
  }
}
function panes(root: any): any[] {
  if (!root) return [];
  return root.kind === "pane" ? [root.pane] : (root.group?.children ?? []).flatMap(panes);
}
function openTabs(id: string) {
  const server = /^\/h\/([^/]+)\//.exec(window.location.pathname)?.[1];
  return Object.entries(layoutStore?.getState().layoutByWorkspace ?? {}).flatMap(([key, layout]: [string, any]) =>
    key.startsWith(`${server}:`) ? panes(layout.root).flatMap(pane => pane.tabs.filter((tab: any) => tab.target.kind === "agent" && tab.target.agentId === id).map((tab: any) => ({ key, tab }))) : []);
}
export function rowCanClose(id: string) { return Platform.OS === "web" && !!layoutStore && openTabs(id).length > 0; }
export function closeRowTab(id: string) {
  for (const { key, tab } of openTabs(id)) {
    const state = layoutStore.getState();
    state.hideAgent(key, id);
    state.closeTab(key, tab.tabId);
  }
}
export const copyRowText = copyText;
