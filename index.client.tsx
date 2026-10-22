import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Dialogs, Destination, Archive } from "./client/dialogs";
import { ReadMarker } from "./client/marker";
import { markerSchema } from "./shared/contracts";
import { DisplaySettings } from "./client/settings";
import { subscribeOnce } from "./client/data";
export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({ id: "display", title: "Диалоги", icon: "PanelsTopLeft", Component: DisplaySettings });
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
  client.addSidebarHeaderItem({
    id: "dialogs",
    title: "Диалоги",
    Component: Dialogs,
  });
  client.addTimelineRenderer({
    kind: "read-marker",
    version: 1,
    schema: markerSchema,
    Component: ReadMarker,
  });
  return subscribeOnce(client.paseo);
}
