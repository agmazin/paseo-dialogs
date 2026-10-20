import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { displaySettings } from "../shared/settings";

export function DisplaySettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(displaySettings);
  if (settings.status !== "ready") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>
      {settings.status === "loading" ? "Загрузка настроек..." : "Не удалось загрузить настройки"}
    </Text>;
  }
  return <SettingsSection title="Боковая панель">
    <SettingsCard>
      <SettingsSwitch
        label="Показывать родной список Workspaces"
        hint="Только на компьютере. На телефоне родной список остаётся видимым."
        value={settings.values.showNativeWorkspaces}
        disabled={settings.saving}
        onValueChange={showNativeWorkspaces => {
          void settings.save({ ...settings.values, showNativeWorkspaces }, settings.revision);
        }}
        error={settings.saveError ? "Не удалось сохранить настройку" : undefined}
      />
    </SettingsCard>
  </SettingsSection>;
}
