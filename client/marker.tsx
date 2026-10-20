import { useEffect, useRef } from "react";
import { View } from "react-native";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { markRead } from "../shared/contracts";
import { observeTail } from "./web";
export function ReadMarker({
  item,
}: PluginTimelineItemProps<{ agentId: string; token: string }>) {
  const node = useRef<View>(null);
  const read = useRpc(markRead);
  useEffect(() => {
    let pending = false,
      done = false;
    return observeTail(node.current, () => {
      if (done || pending) return;
      pending = true;
      void read(item.data)
        .then(() => {
          done = true;
        })
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    });
  }, [read, item.data.agentId, item.data.token]);
  return (
    <View
      ref={node}
      collapsable={false}
      testID={`dialogs-marker-${item.data.token}`}
      style={{ height: 0, width: 1 }}
    />
  );
}
