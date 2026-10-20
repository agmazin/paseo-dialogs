import { useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";
import { bindGroupDrag, bindDialogDrag } from "./web";

export function SortableGroups({ order, disabled, onMove, onDialogMove, canMoveDialog, color, background, children }: {
  order: string[];
  disabled: boolean;
  onMove: (id: string, beforeId: string | null) => void;
  onDialogMove: (agentId: string, targetId: string) => void;
  canMoveDialog: (agentId: string) => boolean;
  color: string;
  background: string;
  children: ReactNode;
}) {
  const root = useRef<View>(null);
  const callback = useRef(onMove);
  callback.current = onMove;
  const dialogs = useRef({ onDialogMove, canMoveDialog });
  dialogs.current = { onDialogMove, canMoveDialog };
  const key = JSON.stringify(order);
  useEffect(() => {
    if (disabled) return;
    return bindGroupDrag(root.current, (id, beforeId) => callback.current(id, beforeId));
  }, [key, disabled]);
  useEffect(() => {
    if (disabled) return;
    return bindDialogDrag(root.current, color, background,
      (id, target) => dialogs.current.onDialogMove(id, target),
      id => dialogs.current.canMoveDialog(id));
  }, [disabled, color, background]);
  return <View ref={root} testID="dialogs-groups">{children}</View>;
}
