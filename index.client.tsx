import type { PluginClientContext, PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useLayoutEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

function Spike({ theme, openScreen }: PluginSidebarItemProps) {
  const paseo = usePaseo();
  const [target, setTarget] = useState<string>();
  useEffect(() => {
    let active = true;
    void paseo.agents.list().then(({ entries }) => {
      if (active) setTarget(entries[0]?.agent.id);
    });
    return () => { active = false; };
  }, [paseo]);
  return <View style={{ padding: 10 }}>
    <Text style={{ color: theme.colors.foregroundMuted }}>Диалоги</Text>
    <Pressable onPress={() => target && openScreen({ screenId: "navigate", params: { agentId: target } })}>
      <Text style={{ color: theme.colors.foreground }}>Проверка навигации</Text>
    </Pressable>
  </View>;
}

function Navigate({ navigation, params }: PluginScreenProps) {
  useLayoutEffect(() => {
    if (params.agentId) navigation?.openAgent({ agentId: params.agentId });
  }, [navigation, params.agentId]);
  return null;
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "navigate", title: "Диалоги", Component: Navigate });
  client.addSidebarHeaderItem({ id: "dialogs", title: "Диалоги", Component: Spike });
  return () => {};
}
