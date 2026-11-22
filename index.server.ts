import type { PluginServerContext } from "@getpaseo/plugin/server";
import { register } from "./server/runtime";
import { displaySettings, sidebarVisibility } from "./shared/settings";
export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(displaySettings);
  if (sidebarVisibility) server.handle(sidebarVisibility, async (_, { paseo, push, signal }) => {
    const { self } = await paseo.hosts.list();
    if (signal.aborted) return;
    const host = { id: self.serverId, label: self.label };
    const publish = (state: Awaited<ReturnType<typeof settings.read>>) =>
      push({ host, showNativeWorkspaces: state.status !== "ready" || state.values.showNativeWorkspaces });
    let changed = false;
    const unsubscribe = settings.subscribe(next => {
      changed = true;
      return publish(next);
    });
    try {
      const initial = await settings.read();
      if (!changed && !signal.aborted) await publish(initial);
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    } finally {
      await unsubscribe();
    }
  });
  return register(server);
}
