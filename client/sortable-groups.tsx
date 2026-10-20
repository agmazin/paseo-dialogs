import { useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import { bindGroupDrag } from "./web";

export function SortableGroups({ order, disabled, onMove, children }: {
  order: string[];
  disabled: boolean;
  onMove: (id: string, beforeId: string | null) => void;
  children: ReactNode;
}) {
  const root = useRef<View>(null);
  const callback = useRef(onMove);
  callback.current = onMove;
  const key = JSON.stringify(order);
  useEffect(() => {
    if (disabled) return;
    return bindGroupDrag(root.current, (id, beforeId) => callback.current(id, beforeId));
  }, [key, disabled]);
  return <View ref={root} testID="dialogs-groups">{children}</View>;
}
