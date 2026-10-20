import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Dialogs, Destination, Archive } from "./client/dialogs";
import { ReadMarker } from "./client/marker";
import { markerSchema } from "./shared/contracts";
export default function contribute(client: PluginClientContext) {
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
  return () => {};
}
