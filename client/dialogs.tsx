import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import {
  useAgent,
  usePaseo,
  useRpc,
  type PluginSidebarItemProps,
  type PluginScreenProps,
  type PluginPopoverProps,
} from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaseoAgent } from "@getpaseo/client";
import { claimAction, preference, ROOT } from "../shared/contracts";
import { activityTime, bucket } from "../shared/model";
import { agents, useData } from "./data";
import { hasBrowser } from "./web";
import {
  AgentLine,
  ArchiveLine,
  Block,
  GroupLine,
  Label,
  MenuView,
  MoreLine,
  WorkspaceForm,
  type Theme,
  type Status,
} from "./ui";
function Activity({
  id,
  onActivity,
}: {
  id: string;
  onActivity: (id: string, time: string) => void;
}) {
  const time = useAgent(id, (a) => a.lastActivityAt);
  useEffect(() => {
    if (time) onActivity(id, time);
  }, [id, time, onActivity]);
  return null;
}
function AgentRow({
  agent,
  theme,
  unread,
  onPress,
  selected = false,
  time,
}: {
  agent: PaseoAgent;
  theme: Theme;
  unread?: boolean;
  onPress: () => void;
  selected?: boolean;
  time?: string;
}) {
  const liveTime = useAgent(agent.id, (a) => a.lastActivityAt);
  return (
    <AgentLine
      theme={theme}
      title={agent.title || "Новый диалог"}
      time={activityTime(
        liveTime ?? time ?? agent.lastUserMessageAt ?? agent.createdAt,
      )}
      provider={agent.provider}
      status={bucket(agent, unread)}
      old={!!agent.archivedAt}
      selected={selected}
      onPress={onPress}
    />
  );
}
function CreateWorkspace(p: PluginPopoverProps) {
  const paseo = usePaseo(),
    qc = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () =>
      paseo.workspaces.create({
        title: name.trim(),
        source: { kind: "directory", path: ROOT },
      }),
    onSuccess: async (w) => {
      await qc.invalidateQueries({ queryKey: ["dialogs", p.host.id] });
      p.openScreen({ screenId: "navigate", params: { workspaceId: w.id } });
    },
  });
  return (
    <WorkspaceForm
      theme={p.theme}
      name={name}
      onName={setName}
      onCreate={() => create.mutate()}
      onClose={p.close}
      compact={p.layout.compact}
      pending={create.isPending}
      error={create.isError ? "Не удалось создать пространство" : undefined}
    />
  );
}
function PlusMenu(p: PluginPopoverProps & { workspaceId: string }) {
  const paseo = usePaseo();
  const profiles = useQuery({
    queryKey: ["dialogs-profiles", p.host.id],
    queryFn: async () =>
      (await paseo.config.get()).config.terminalProfiles ?? [],
  });
  const go = (action: string, profileId?: string) =>
    p.openScreen({
      screenId: "navigate",
      params: {
        workspaceId: p.workspaceId,
        action,
        token: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ...(profileId ? { profileId } : {}),
      },
    });
  return (
    <MenuView
      theme={p.theme}
      onAgent={() => go("agent")}
      onTerminal={() => go("terminal")}
      onBrowser={hasBrowser() ? () => go("browser") : undefined}
      profiles={profiles.data ?? []}
      onProfile={(id) => go("terminal", id)}
    />
  );
}
export function Dialogs(p: PluginSidebarItemProps) {
  const d = useData(p.host.id),
    qc = useQueryClient(),
    save = useRpc(preference);
  const [limits, setLimits] = useState<Record<string, number>>({}),
    [selected, setSelected] = useState<string | null>(null),
    [activity, setActivity] = useState<Record<string, string>>({});
  const onActivity = useCallback(
    (id: string, time: string) =>
      setActivity((old) => (old[id] === time ? old : { ...old, [id]: time })),
    [],
  );
  const pref = useMutation({
    mutationFn: save,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dialogs", p.host.id] }),
  });
  const openAgent = (id: string) => {
    setSelected(id);
    p.openScreen({ screenId: "navigate", params: { agentId: id } });
  };
  if (!d.data)
    return (
      <Label color={p.theme.colors.foregroundMuted} size={13}>
        {d.isError ? "Диалоги: ошибка загрузки" : "Диалоги: загрузка..."}
      </Label>
    );
  const { agents: raw, workspaces, terminals, state } = d.data;
  const all = [...raw].sort((a, b) =>
    (activity[b.id] ?? b.lastUserMessageAt ?? b.createdAt).localeCompare(
      activity[a.id] ?? a.lastUserMessageAt ?? a.createdAt,
    ),
  );
  const status = (a: PaseoAgent) =>
    bucket(
      a,
      Object.hasOwn(state.unread, a.id) ? !!state.unread[a.id] : undefined,
    );
  return (
    <Block theme={p.theme} onAdd={() => p.openPopover(CreateWorkspace)}>
      {all.map((a) => (
        <Activity key={a.id} id={a.id} onActivity={onActivity} />
      ))}
      {pref.isError && (
        <Label color={p.theme.colors.statusDanger} size={12}>
          Не удалось сохранить настройку
        </Label>
      )}
      {workspaces.map((w) => {
        const active = all.filter(
            (a) => a.workspaceId === w.id && !a.archivedAt,
          ),
          archive = all.filter((a) => a.workspaceId === w.id && a.archivedAt),
          ts = terminals
            .filter((t) => t.workspaceId === w.id)
            .sort((a, b) => a.name.localeCompare(b.name));
        const folded = state.collapsed[w.id] ?? false,
          archOpen = state.archives[w.id] ?? false,
          limit = limits[w.id] ?? 10;
        const counts: Partial<Record<Status, number>> = {};
        active.forEach((a) => {
          const s = status(a);
          counts[s] = (counts[s] ?? 0) + 1;
        });
        const row = (a: PaseoAgent) => (
          <AgentRow
            key={a.id}
            agent={a}
            theme={p.theme}
            time={activity[a.id]}
            unread={
              Object.hasOwn(state.unread, a.id)
                ? !!state.unread[a.id]
                : undefined
            }
            selected={selected === a.id}
            onPress={() => openAgent(a.id)}
          />
        );
        return (
          <View key={w.id}>
            <GroupLine
              theme={p.theme}
              name={w.name}
              count={active.length + ts.length}
              counts={counts}
              collapsed={folded}
              compact={p.layout.compact}
              onPress={() =>
                pref.mutate({ section: "collapsed", id: w.id, value: !folded })
              }
              onAdd={() =>
                p.openPopover((props) => (
                  <PlusMenu {...props} workspaceId={w.id} />
                ))
              }
            />
            {!folded && (
              <>
                {active.map(row)}
                {ts.map((t) => (
                  <AgentLine
                    key={t.id}
                    theme={p.theme}
                    title={t.name}
                    provider="terminal"
                    time=""
                    onPress={() => {
                      setSelected(null);
                      p.openScreen({
                        screenId: "navigate",
                        params: { workspaceId: w.id },
                      });
                    }}
                  />
                ))}
                {!!archive.length && (
                  <>
                    <ArchiveLine
                      theme={p.theme}
                      count={archive.length}
                      open={archOpen}
                      onPress={() =>
                        pref.mutate({
                          section: "archives",
                          id: w.id,
                          value: !archOpen,
                        })
                      }
                    />
                    {archOpen && (
                      <>
                        {archive.slice(0, limit).map(row)}
                        {archive.length > limit && limit < 30 && (
                          <MoreLine
                            label="Показать ещё 10"
                            theme={p.theme}
                            onPress={() =>
                              setLimits({ ...limits, [w.id]: limit + 10 })
                            }
                          />
                        )}{" "}
                        {archive.length > 30 && limit >= 30 && (
                          <MoreLine
                            label={`Весь архив: ${archive.length}`}
                            theme={p.theme}
                            onPress={() =>
                              p.openScreen({
                                screenId: "archive",
                                params: { workspaceId: w.id },
                              })
                            }
                          />
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </View>
        );
      })}
    </Block>
  );
}
export function Destination({
  navigation,
  params,
  theme,
  host,
}: PluginScreenProps) {
  const paseo = usePaseo();
  const claim = useRpc(claimAction);
  const started = useRef("");
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const key = JSON.stringify(params);
    if (started.current === key) return;
    started.current = key;
    void (async () => {
      if (!navigation) throw new Error("Навигация недоступна на этом клиенте");
      if (params.agentId) {
        navigation.openAgent({ agentId: params.agentId });
        return;
      }
      const id = params.workspaceId;
      if (!id) throw new Error("Не выбрано пространство");
      if (
        params.action &&
        (!params.token || !(await claim({ token: params.token })).claimed)
      ) {
        navigation.openWorkspace({ workspaceId: id });
        return;
      }
      if (params.action === "agent") {
        const all = await agents(paseo);
        const last =
          all
            .filter((a) => a.workspaceId === id)
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
        const agent = await paseo.workspaces
          .ref(id)
          .agents.create({
            config: config ?? fallback,
            idempotencyKey: params.token,
          });
        navigation.openAgent({ agentId: agent.id });
        return;
      }
      if (params.action === "terminal") {
        const profiles =
          (await paseo.config.get()).config.terminalProfiles ?? [];
        const profile = profiles.find((p) => p.id === params.profileId);
        if (params.profileId && !profile)
          throw new Error("Профиль терминала удалён");
        await paseo.workspaces
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
      }
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
    })().catch((e) =>
      setError(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
      ),
    );
  }, [navigation, params, paseo, claim]);
  return error ? (
    <View style={{ padding: 16 }}>
      <Text style={{ color: theme.colors.statusDanger }}>{error}</Text>
    </View>
  ) : null;
}
export function Archive({
  params,
  theme,
  navigation,
  host,
}: PluginScreenProps) {
  const d = useData(host.id);
  const [query, setQuery] = useState("");
  const list =
    d.data?.agents.filter(
      (a) =>
        a.workspaceId === params.workspaceId &&
        a.archivedAt &&
        (a.title ?? "").toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) ?? [];
  return (
    <View
      style={{
        flex: 1,
        padding: 16,
        backgroundColor: theme.colors.surface0,
        gap: 12,
      }}
    >
      <TextInput
        accessibilityLabel="Поиск по архиву"
        value={query}
        onChangeText={setQuery}
        placeholder="Поиск по названию"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{
          padding: 10,
          color: theme.colors.foreground,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 6,
        }}
      />
      <Label color={theme.colors.foregroundMuted}>Найдено: {list.length}</Label>
      <ScrollView>
        {list.map((a) => (
          <AgentRow
            key={a.id}
            agent={a}
            theme={theme}
            onPress={() => navigation?.openAgent({ agentId: a.id })}
          />
        ))}
      </ScrollView>
    </View>
  );
}
