import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { Theme } from "./ui";
import type { DialogLoadState } from "./loading";

const labels: Record<DialogLoadState, string> = {
  connecting: "Подключаемся к серверу диалогов...",
  loading: "Загружаем список диалогов...",
  refreshing: "Обновляем список диалогов...",
  error: "Не удалось загрузить список диалогов",
  "stale-error": "Не удалось обновить список диалогов",
  ready: "",
};

export function DialogLoadStatus({ state, theme, retry }: {
  state: DialogLoadState;
  theme: Theme;
  retry(): void;
}) {
  if (state === "ready") return null;
  const error = state === "error" || state === "stale-error";
  const color = error ? theme.colors.statusDanger : theme.colors.foregroundMuted;
  return (
    <View testID="dialogs-load-status" style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {!error && <ActivityIndicator size="small" color={color} />}
        <Text accessibilityLiveRegion="polite" style={{ color, fontSize: 13, flexShrink: 1 }}>
          {labels[state]}
        </Text>
      </View>
      {error && <Pressable accessibilityRole="button" accessibilityLabel="Повторить загрузку диалогов"
        onPress={retry} style={{ alignSelf: "flex-start", justifyContent: "center", minHeight: 40, paddingHorizontal: 10, paddingVertical: 6,
          borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>Повторить</Text>
      </Pressable>}
    </View>
  );
}
