import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { displaySettings } from "../shared/settings";

export function DisplaySettings({ theme, layout, supportsView }: PluginSurfaceProps & { supportsView: boolean }) {
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
        hint={supportsView
          ? "Чтобы отдать всю панель диалогам, выключите этот переключатель и один раз выберите Диалоги в настройках боковой панели Paseo на устройстве."
          : layout.platform === "web" ? "Управляет списком под блоком Диалоги." : "Чтобы скрыть список на телефоне, нужен Paseo с выбором вида боковой панели."}
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
