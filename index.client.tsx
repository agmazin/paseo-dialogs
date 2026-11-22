import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Destination, Archive } from "./client/dialogs";
import { registerSidebar } from "./client/sidebar";
import { ReadMarker } from "./client/marker";
import { markerSchema } from "./shared/contracts";
import { DisplaySettings } from "./client/settings";
import { subscribeOnce } from "./client/data";
export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({ id: "display", title: "Диалоги", icon: "PanelsTopLeft",
    Component: props => <DisplaySettings {...props} supportsView={typeof client.addSidebarView === "function"} /> });
  client.addScreen({
    id: "navigate",
    title: "Диалоги",
    Component: Destination,
  });
  client.addScreen({
    id: "archive",
    title: "Архив диалогов",
    Component: Archive,
  });
  const removeSidebar = registerSidebar(client);
  client.addTimelineRenderer({
    kind: "read-marker",
    version: 1,
    schema: markerSchema,
    Component: ReadMarker,
  });
  const unsubscribe = subscribeOnce(client.paseo);
  return () => { removeSidebar(); unsubscribe(); };
}
