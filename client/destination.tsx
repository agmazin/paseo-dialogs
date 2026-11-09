import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { usePaseo, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { claimAction, readAgents } from "../shared/contracts";
import { topLevel } from "../shared/model";
import { isNavigationScreenActive, openArchivedAgent, openAgentDraft, activateTerminalTab } from "./web";

export function Destination({
  navigation,
  params,
  theme,
  host,
}: PluginScreenProps) {
  const paseo = usePaseo();
  const claim = useRpc(claimAction);
  const getAgents = useRpc(readAgents);
  const [attempt, setAttempt] = useState(0);
  const paramsKey = JSON.stringify(params);
  const latest = useRef({ navigation, paseo, claim, getAgents });
  latest.current = { navigation, paseo, claim, getAgents };
  const [error, setError] = useState("");
  useEffect(() => {
    const params: PluginScreenProps["params"] = JSON.parse(paramsKey);
    let cancelled = false;
    setError("");
    const stillCurrent = () => !cancelled && isNavigationScreenActive(params);
    const timeout = setTimeout(() => {
      cancelled = true;
      setError("Переход не завершился. Проверьте подключение и повторите попытку");
    }, 15_000);
    // Native navigation reads the committed parent stack. Never redirect during child layout.
    const run = async () => {
      const { navigation, paseo, claim, getAgents } = latest.current;
      // Retained screens can mount before the router commits the matching address.
      for (let attempt = 0; !isNavigationScreenActive(params); attempt++) {
        if (cancelled) return;
        if (attempt >= 100) throw new Error("Не удалось открыть диалог. Повторите клик");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (cancelled) return;
      if (!navigation) throw new Error("Навигация недоступна на этом клиенте");
      if (params.agentId) {
        if (params.archived === "true" && await openArchivedAgent(params.agentId, params.workspaceId, stillCurrent)) return;
        if (params.workspaceId) {
          await paseo.agents.ref(params.agentId).refresh();
          if (!stillCurrent()) return;
        }
        if (stillCurrent()) navigation.openAgent({ agentId: params.agentId });
        return;
      }
      const id = params.workspaceId;
      if (!id) throw new Error("Не выбрана папка");
      if (
        params.action &&
        (!params.token || !(await claim({ token: params.token })).claimed)
      ) {
        if (stillCurrent()) navigation.openWorkspace({ workspaceId: id });
        return;
      }
      if (!stillCurrent()) return;
      if (params.action === "agent") {
        if (openAgentDraft(id)) return;
        // Phones: no draft route for plugins, so the new dialog takes the group's last provider.
        const all = (await getAgents({ archives: [], limit: 0 })).agents;
        const last =
          all
            .filter((a) => a.workspaceId === id && topLevel(a))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ??
          all[0];
        const config = last
          ? {
              provider: `${last.provider}/${last.model ?? "default"}`,
              modeId: last.currentModeId ?? undefined,
              thinkingOptionId: last.thinkingOptionId ?? undefined,
            }
          : undefined;
        const profiles = (await paseo.config.get()).config.agentProfiles ?? [];
        const first = profiles[0];
        const fallback = first
          ? {
              provider: `${first.provider}/${first.model ?? "default"}`,
              modeId: first.modeId,
              thinkingOptionId: first.thinkingOptionId,
            }
          : { provider: "claude/opus" };
        if (!stillCurrent()) return;
        const agent = await paseo.workspaces
          .ref(id)
          .agents.create({
            config: config ?? fallback,
            idempotencyKey: params.token,
          });
        if (stillCurrent()) navigation.openAgent({ agentId: agent.id });
        return;
      }
      let terminalId = params.terminalId;
      if (params.action === "terminal") {
        const profiles =
          (await paseo.config.get()).config.terminalProfiles ?? [];
        const profile = profiles.find((p) => p.id === params.profileId);
        if (params.profileId && !profile)
          throw new Error("Профиль терминала удалён");
        if (!stillCurrent()) return;
        const terminal = await paseo.workspaces
          .ref(id)
          .terminals.create(
            profile
              ? {
                  name: profile.name,
                  command: profile.command,
                  args: profile.args,
                }
              : {},
          );
        terminalId = terminal.id;
      }
      if (!stillCurrent()) return;
      if (params.action === "browser") {
        if (!navigation.openBrowser)
          throw new Error("Браузер доступен только в настольном Paseo");
        navigation.openBrowser({
          workspaceId: id,
          url: "https://www.google.com",
        });
        return;
      }
      navigation.openWorkspace({ workspaceId: id });
      if (terminalId) await activateTerminalTab(terminalId);
    };
    const scheduled = setTimeout(() => {
      void run().catch((e) => {
        clearTimeout(timeout);
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
      });
    }, 0);
    return () => { cancelled = true; clearTimeout(scheduled); clearTimeout(timeout); };
  }, [host.id, paramsKey, attempt]);
  return (
    <View testID="dialogs-navigation-status" style={{ padding: 16, gap: 12, backgroundColor: theme.colors.surface0 }}>
      {!error && <ActivityIndicator color={theme.colors.foregroundMuted} />}
      <Text accessibilityLiveRegion="polite" style={{ color: error ? theme.colors.statusDanger : theme.colors.foregroundMuted }}>
        {error || "Открываем диалог..."}
      </Text>
      {!!error && <Pressable accessibilityRole="button" accessibilityLabel="Повторить переход"
        onPress={() => setAttempt(value => value + 1)}
        style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6 }}>
        <Text style={{ color: theme.colors.foreground }}>Повторить</Text>
      </Pressable>}
    </View>
  );
}
