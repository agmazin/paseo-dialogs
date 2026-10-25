import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import {
  useAgent,
  useSettings,
  usePaseo,
  useRpc,
  type PluginSidebarItemProps,
  type PluginScreenProps,
  type PluginPopoverProps,
} from "@getpaseo/plugin/client";
import { Modal as HostModal, TextInput as HostTextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SlimAgent as PaseoAgent } from "../shared/contracts";
import { displaySettings } from "../shared/settings";
import { claimAction, preference, reorderGroups, moveDialog, readAgents, readArchive, ROOT } from "../shared/contracts";
import { reconcileOrder, moveGroup } from "../shared/order";
import { SortableGroups } from "./sortable-groups";
import { archiveImpact } from "../shared/archive";
import { activityTime, atRest, bucket, latest, runningByParent } from "../shared/model";
import { agents, setState, useData } from "./data";
import { hideNativeWorkspaces, hasBrowser, observeSelectedTab, isNavigationScreenActive, activateTerminalTab, hasOpenAgentTab, confirmDestructive, isWorkspaceRouteOpen, openAgentDraft, openArchivedAgent, bindAgentMenu } from "./web";
import {
  palette,
  AgentLine,
  ArchiveLine,
  Block,
  GroupLine,
  GroupMenuView,
  Label,
  MenuView,
  MenuLine,
  MoreLine,
  WorkspaceForm,
  type Theme,
  type MenuAnchor,
  type Status,
} from "./ui";
function Activity({
  id,
  onActivity,
}: {
  id: string;
  onActivity: (id: string, time: string) => void;
}) {
  // The host's lastActivityAt also moves on renames and labels (Kanban numbers), so it counts only
  // while the agent works and at the moment its turn ends.
  const live = useAgent(id, (a) => ({ status: a.status, time: a.lastActivityAt }));
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!live) return;
    const running = live.status === "running" || live.status === "initializing";
    if ((running || wasRunning.current) && live.time) onActivity(id, live.time);
    wasRunning.current = running;
  }, [id, live?.status, live?.time, onActivity]);
  return null;
}
function AgentRow({
  agent,
  theme,
  unread,
  onPress,
  selected = false,
  time,
  subagents,
  open,
  onToggle,
  sub,
  onMenu,
}: {
  agent: PaseoAgent;
  theme: Theme;
  unread?: boolean;
  onPress: () => void;
  selected?: boolean;
  time?: string;
  subagents?: number;
  open?: boolean;
  onToggle?: () => void;
  sub?: boolean;
  onMenu?: (anchor?: MenuAnchor) => void;
}) {
  const node = useRef<View>(null);
  useEffect(() => bindAgentMenu(node.current, onMenu), [onMenu]);
  return (
    <View ref={node} testID={`dialogs-agent-${agent.id}`}>
    <AgentLine
      theme={theme}
      title={agent.title || "Новый диалог"}
      time={activityTime(
        latest(time, agent.lastActivityAt, agent.lastUserMessageAt) ?? agent.createdAt,
      )}
      provider={agent.provider}
      status={bucket(agent, unread)}
      old={!!agent.archivedAt}
      sub={sub}
      subagents={subagents}
      open={open}
      onToggle={onToggle}
      selected={selected}
      onPress={onPress}
      onMenu={onMenu}
    />
    </View>
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
      error={create.isError ? "Не удалось создать папку" : undefined}
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
// Mirrors the host rename sheet: one field, Cancel and Rename, inline error.
function RenameGroup({ theme, name, onSubmit, onClose }: {
  theme: PluginSidebarItemProps["theme"];
  name: string;
  onSubmit: (title: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const p = palette(theme);
  const submit = async () => {
    if (pending || draft === name) return;
    if (!draft.trim()) { setError("Требуется имя"); return; }
    setPending(true);
    try { await onSubmit(draft.trim()); onClose(); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : "Не удалось сохранить"); }
    finally { setPending(false); }
  };
  const button = (label: string, onPress: () => void, primary: boolean, disabled: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={{ flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center",
        opacity: disabled ? 0.5 : 1, backgroundColor: primary ? theme.colors.foreground : "transparent",
        borderWidth: primary ? 0 : 1, borderColor: theme.colors.border }}>
      <Label color={primary ? theme.colors.surface0 : p.fg} size={13} weight="500">{label}</Label>
    </Pressable>
  );
  return (
    <HostModal title="Переименовать папку" open onOpenChange={open => { if (!open && !pending) onClose(); }}>
      <HostModal.Content>
        <View testID="dialogs-rename-group" style={{ gap: 12 }}>
          <HostTextInput accessibilityLabel="Название группы" value={draft} placeholder={name} autoFocus
            editable={!pending} onChangeText={v => { setDraft(v); setError(""); }} onSubmitEditing={() => void submit()}
            style={{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0, color: theme.colors.foreground, fontSize: 14 }} />
          {!!error && <Label color={theme.colors.statusDanger} size={14}>{error}</Label>}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {button("Отмена", onClose, false, pending)}
            {button(pending ? "Сохранение..." : "Переименовать", () => void submit(), true,
              pending || draft === name || !draft.trim())}
          </View>
        </View>
      </HostModal.Content>
    </HostModal>
  );
}
export function Dialogs(p: PluginSidebarItemProps) {
  const dimensions = useWindowDimensions();
  const settings = useSettings(displaySettings);
  const hideNative = settings.status === "ready" && !settings.values.showNativeWorkspaces;
  useEffect(() => hideNativeWorkspaces(hideNative), [hideNative]);
  const [popup, setPopup] = useState<{ Content: ComponentType<PluginPopoverProps>; anchor: MenuAnchor; width: number } | null>(null);
  const [popupHeight, setPopupHeight] = useState(220);
  const show = (Content: ComponentType<PluginPopoverProps>, anchor: MenuAnchor | undefined, width: number, overSidebar = false) => {
    if ((p.layout.compact && !overSidebar) || !anchor) { p.openPopover(Content); return; }
    setPopup({ Content, anchor, width });
  };
  const closePopup = () => setPopup(null);
  const d = useData(p.host.id),
    qc = useQueryClient(),
    save = useRpc(preference),
    reorder = useRpc(reorderGroups),
    move = useRpc(moveDialog),
    toast = useToast();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [moveError, setMoveError] = useState("");
  const [limits, setLimits] = useState<Record<string, number>>({}),
    [selected, setSelected] = useState<string | null>(null),
    [activity, setActivity] = useState<Record<string, string>>({}),
    [branches, setBranches] = useState<Record<string, boolean>>({});
  useEffect(() => observeSelectedTab(setSelected), []);
  const menuFor = useRef<(id: string, anchor?: MenuAnchor) => void>(() => {});
  const onActivity = useCallback(
    (id: string, time: string) => {
      setActivity((old) => (old[id] === time ? old : { ...old, [id]: time }));
      qc.setQueryData<Record<string, string>>(["dialogs-activity", p.host.id], old => ({ ...old, [id]: time }));
    },
    [qc, p.host.id],
  );
  // Folding is instant: the cache changes first, the daemon answers with the saved state.
  const pref = useMutation({
    mutationFn: save,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["dialogs", p.host.id] });
      qc.setQueryData<typeof d.data>(["dialogs", p.host.id], old => old ? {
        ...old, state: { ...old.state, [input.section]: { ...old.state[input.section], [input.id]: input.value } },
      } : old);
    },
    onSuccess: (state, input) => {
      setState(qc, p.host.id, state);
      // An opened archive needs its rows: they are loaded on demand.
      if (input.section === "archives" && input.value) void qc.invalidateQueries({ queryKey: ["dialogs", p.host.id] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ["dialogs", p.host.id] }),
  });
  const orderMutation = useMutation({
    mutationFn: reorder,
    onMutate: async (move) => {
      await qc.cancelQueries({ queryKey: ["dialogs", p.host.id] });
      qc.setQueryData<typeof d.data>(["dialogs", p.host.id], old => old ? {
        ...old, state: { ...old.state, groupOrder: moveGroup(old.state.groupOrder, move.id, move.beforeId) },
      } : old);
    },
    onSuccess: (state) => setState(qc, p.host.id, state),
    onError: () => qc.invalidateQueries({ queryKey: ["dialogs", p.host.id] }),
  });
  const openAgent = (id: string, archived = false, workspaceId?: string | null) => {
    setSelected(id);
    p.openScreen({ screenId: "navigate", params: { agentId: id, request: `${Date.now()}-${Math.random()}`, ...(archived ? { archived: "true", ...(workspaceId ? { workspaceId } : {}) } : {}) } });
  };
  const transferMutation = useMutation({
    mutationFn: async (input: { agentId: string; sourceId: string; targetId: string; open: boolean }) => {
      setMoveError("");
      return { ...await move(input), open: input.open };
    },
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["dialogs", p.host.id] });
      if (result.open) p.openScreen({
        screenId: "navigate", params: { agentId: result.agentId, workspaceId: result.workspaceId },
      });
    },
    onError: (error) => setMoveError(error instanceof Error
      ? error.message.replace(/^Request failed: /, "").replace(/ requestType=.*$/, "")
      : "Не удалось перенести диалог"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["dialogs", p.host.id] }),
  });
  if (!d.data)
    return (
      <Label color={p.theme.colors.foregroundMuted} size={13}>
        {d.isError ? "Диалоги: ошибка загрузки" : "Диалоги: загрузка..."}
      </Label>
    );
  const { agents: raw, workspaces, terminals, state, archiveCounts } = d.data;
  const groupOrder = reconcileOrder(state.groupOrder, workspaces.map(w => w.id));
  const workspaceById = new Map(workspaces.map(w => [w.id, w]));
  const kids = runningByParent(raw);
  const seen = (a: PaseoAgent) => latest(activity[a.id], a.lastActivityAt, a.lastUserMessageAt) ?? a.createdAt;
  const all = raw.filter((a) => !a.parentAgentId).sort((a, b) => seen(b).localeCompare(seen(a)));
  const status = (a: PaseoAgent) =>
    bucket(
      a,
      Object.hasOwn(state.unread, a.id) ? !!state.unread[a.id] : undefined,
    );
  // Host behavior: archive the workspace with its agents and terminals, toast the daemon error.
  const removeGroup = async (id: string, name: string, dialogs: number, terminalCount: number) => {
    const message = [
      dialogs ? `Диалогов в группе: ${dialogs}. Они уйдут в архив вместе с группой и останутся в Истории Paseo.` : "Группа пуста.",
      terminalCount ? `Терминалы группы будут закрыты: ${terminalCount}.` : "",
      "Файлы на диске не будут изменены.",
    ].filter(Boolean).join("\n\n");
    if (!await confirmDestructive({ title: `Удалить группу "${name}"?`, message, confirm: "Удалить", cancel: "Отмена" })) return;
    // Like the host, leave the workspace before it is archived.
    const next = groupOrder.find(g => g !== id);
    if (next && isWorkspaceRouteOpen(id)) p.openScreen({ screenId: "navigate", params: { workspaceId: next } });
    await qc.cancelQueries({ queryKey: ["dialogs", p.host.id] });
    qc.setQueryData<typeof d.data>(["dialogs", p.host.id], old => old ? {
      ...old, workspaces: old.workspaces.filter(w => w.id !== id),
      state: { ...old.state, groupOrder: old.state.groupOrder.filter(g => g !== id) },
    } : old);
    try {
      const result = await d.paseo.workspaces.ref(id).archive();
      if (result.error) throw new Error(result.error);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Не удалось архивировать папку");
    } finally {
      await qc.invalidateQueries({ queryKey: ["dialogs", p.host.id] });
    }
  };
  const archiveDialog = async (agent: PaseoAgent) => {
    try {
      const records = (await agents(d.paseo, true)).filter(a => !a.archivedAt);
      const { children, working } = archiveImpact(agent, records);
      const message = [working ? "Агент ещё работает. Архивация остановит его или работающих подагентов." : "Диалог останется в Архиве.",
        children ? `Вместе с ним уйдут в архив подагенты: ${children}.` : ""].filter(Boolean).join("\n\n");
      if ((working || children > 0) && !await confirmDestructive({ title: "Архивировать диалог?", message, confirm: "Архивировать", cancel: "Отмена" })) return;
      await d.paseo.agents.ref(agent.id).archive();
      await qc.invalidateQueries({ queryKey: ["dialogs", p.host.id] });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось архивировать диалог"); }
  };
  const dialogMenu = (agent: PaseoAgent, anchor?: MenuAnchor) => show(props => (
    <View testID="dialogs-agent-menu" style={{ padding: 6, borderRadius: 12, backgroundColor: palette(props.theme).menu, borderWidth: 1, borderColor: palette(props.theme).line }}>
      <MenuLine theme={props.theme} label="Архивировать" icon="Archive" onPress={() => { props.close(); void archiveDialog(agent); }} />
    </View>
  ), anchor, 230, true);
  menuFor.current = (id, anchor) => {
    const w = workspaceById.get(id);
    if (!w) return;
    const dialogs = all.filter(a => a.workspaceId === id).length,
      terminalCount = terminals.filter(t => t.workspaceId === id).length;
    show(props => (
      <GroupMenuView theme={props.theme}
        onRename={() => { props.close(); setRenaming({ id, name: w.name }); }}
        onDelete={() => { props.close(); void removeGroup(id, w.name, dialogs, terminalCount); }} />
    ), anchor, 260);
  };
  return (
    <>
    {renaming && <RenameGroup theme={p.theme} name={renaming.name} onClose={() => setRenaming(null)}
      onSubmit={async title => {
        await d.paseo.workspaces.ref(renaming.id).setTitle(title);
        await qc.invalidateQueries({ queryKey: ["dialogs", p.host.id] });
      }} />}
    {popup && <Modal transparent visible animationType="none" onRequestClose={closePopup}>
      <Pressable accessibilityLabel="Закрыть меню" onPress={closePopup} style={{ position: "absolute", inset: 0 }} />
      <View onLayout={e => setPopupHeight(e.nativeEvent.layout.height)} style={{ position: "absolute",
        left: Math.max(8, Math.min(popup.anchor.x - 4, dimensions.width - popup.width - 8)),
        top: popup.anchor.y + 30 + popupHeight > dimensions.height - 8 ? Math.max(8, popup.anchor.y - popupHeight - 6) : popup.anchor.y + 30,
      }}>
        <popup.Content {...p} close={closePopup} openScreen={input => { closePopup(); p.openScreen(input); }} />
      </View>
    </Modal>}
    <Block theme={p.theme} compact={p.layout.compact} onAdd={(anchor) => show(CreateWorkspace, anchor, 290)}>
      {raw.filter((a) => !a.archivedAt).map((a) => (
        <Activity key={a.id} id={a.id} onActivity={onActivity} />
      ))}
      {pref.isError && (
        <Label color={p.theme.colors.statusDanger} size={12}>
          Не удалось сохранить настройку
        </Label>
      )}
      {orderMutation.isError && <Label color={p.theme.colors.statusDanger} size={12}>Не удалось сохранить порядок. Попробуйте ещё раз.</Label>}
      {!!moveError && <Label color={p.theme.colors.statusDanger} size={12}>{moveError}</Label>}
      {transferMutation.isPending && <Label color={p.theme.colors.foregroundMuted} size={12}>Перенос диалога...</Label>}
      <SortableGroups order={groupOrder}
        disabled={orderMutation.isPending || transferMutation.isPending || p.layout.compact}
        hover={palette(p.theme).hover}
        background={palette(p.theme).active}
        canMoveDialog={id => {
          const a = all.find(a => a.id === id);
          if (!a) return false;
          if (a.status === "running" || a.status === "initializing" || a.activeTurn || a.pendingPermissionCount || a.attentionReason === "permission") {
            setMoveError("Перенести можно, когда агент закончит"); return false;
          }
          setMoveError(""); return true;
        }}
        onDialogMove={(agentId, targetId) => {
          const a = all.find(a => a.id === agentId);
          if (a?.workspaceId) transferMutation.mutate({ agentId, sourceId: a.workspaceId, targetId,
            open: selected === agentId || hasOpenAgentTab(agentId) });
        }}
        onMenu={(id, anchor) => menuFor.current(id, anchor)}
        onMove={(id, beforeId) => orderMutation.mutate({ id, beforeId })}>
      {groupOrder.map(id => workspaceById.get(id)!).map((w) => {
        const active = all.filter(
            (a) => a.workspaceId === w.id && !a.archivedAt,
          ),
          archive = all.filter((a) => a.workspaceId === w.id && a.archivedAt),
          archiveCount = archiveCounts[w.id] ?? archive.length,
          ts = terminals
            .filter((t) => t.workspaceId === w.id)
            .sort((a, b) => a.name.localeCompare(b.name));
        const folded = state.collapsed[w.id] ?? false,
          archOpen = state.archives[w.id] ?? false,
          limit = limits[w.id] ?? 10;
        const counts: Partial<Record<Status, number>> = {};
        active.forEach((a) => {
          // A dialog at rest with working subagents counts as "В работе".
          const own = status(a),
            s = kids.has(a.id) && atRest(own) ? "running" : own;
          counts[s] = (counts[s] ?? 0) + 1;
        });
        const row = (a: PaseoAgent) => {
          const busy = a.archivedAt ? [] : (kids.get(a.id) ?? []),
            open = !!branches[a.id] && busy.length > 0;
          return (
            <View key={a.id}>
              <AgentRow
                agent={a}
                onMenu={a.archivedAt ? undefined : anchor => dialogMenu(a, anchor)}
                theme={p.theme}
                time={activity[a.id]}
                unread={
                  Object.hasOwn(state.unread, a.id)
                    ? !!state.unread[a.id]
                    : undefined
                }
                selected={selected === a.id}
                subagents={busy.length}
                open={open}
                onToggle={() => setBranches((old) => ({ ...old, [a.id]: !old[a.id] }))}
                onPress={() => openAgent(a.id, !!a.archivedAt, a.workspaceId)}
              />
              {open && busy.map((k) => (
                <AgentRow
                  key={k.id}
                  agent={k}
                  theme={p.theme}
                  time={activity[k.id]}
                  sub
                  selected={selected === k.id}
                  onPress={() => openAgent(k.id, !!k.archivedAt, k.workspaceId)}
                />
              ))}
            </View>
          );
        };
        return (
          <View key={w.id} testID={`dialogs-group-${w.id}`}>
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
              onMenu={(anchor) => menuFor.current(w.id, anchor)}
              onAdd={(anchor) => show((props) => (
                  <PlusMenu {...props} workspaceId={w.id} />
                ), anchor, 250)}
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
                    selected={selected === t.id}
                    time=""
                    onPress={() => {
                      setSelected(null);
                      p.openScreen({
                        screenId: "navigate",
                        params: { workspaceId: w.id, terminalId: t.id },
                      });
                    }}
                  />
                ))}
                {archiveCount > 0 && (
                  <>
                    <ArchiveLine
                      theme={p.theme}
                      count={archiveCount}
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
                        {archiveCount > limit && limit < 30 && (
                          <MoreLine
                            label="Показать ещё 10"
                            theme={p.theme}
                            onPress={() =>
                              setLimits({ ...limits, [w.id]: limit + 10 })
                            }
                          />
                        )}{" "}
                        {archiveCount > 30 && limit >= 30 && (
                          <MoreLine
                            label={`Весь архив: ${archiveCount}`}
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
      </SortableGroups>
    </Block>
    </>
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
  const getAgents = useRpc(readAgents);
  const started = useRef("");
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const key = JSON.stringify(params);
    if (started.current === key) return;
    let cancelled = false;
    setError("");
    void (async () => {
      // Retained screens can mount before the router commits the matching address.
      for (let attempt = 0; !isNavigationScreenActive(params); attempt++) {
        if (cancelled) return;
        if (attempt >= 100) throw new Error("Не удалось открыть диалог. Повторите клик");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (cancelled || started.current === key) return;
      started.current = key;
      if (!navigation) throw new Error("Навигация недоступна на этом клиенте");
      if (params.agentId) {
        if (params.archived === "true" && await openArchivedAgent(params.agentId, params.workspaceId, () => !cancelled && isNavigationScreenActive(params))) return;
        if (params.workspaceId) {
          await paseo.agents.ref(params.agentId).refresh();
          navigation.openWorkspace({ workspaceId: params.workspaceId });
        }
        navigation.openAgent({ agentId: params.agentId });
        return;
      }
      const id = params.workspaceId;
      if (!id) throw new Error("Не выбрана папка");
      if (
        params.action &&
        (!params.token || !(await claim({ token: params.token })).claimed)
      ) {
        navigation.openWorkspace({ workspaceId: id });
        return;
      }
      if (params.action === "agent") {
        if (openAgentDraft(id)) return;
        // Phones: no draft route for plugins, so the new dialog takes the group's last provider.
        const all = (await getAgents({ archives: [], limit: 0 })).agents;
        const last =
          all
            .filter((a) => a.workspaceId === id && !a.parentAgentId)
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
      let terminalId = params.terminalId;
      if (params.action === "terminal") {
        const profiles =
          (await paseo.config.get()).config.terminalProfiles ?? [];
        const profile = profiles.find((p) => p.id === params.profileId);
        if (params.profileId && !profile)
          throw new Error("Профиль терминала удалён");
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
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    });
    return () => { cancelled = true; };
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
  const getArchive = useRpc(readArchive);
  const archive = useQuery({
    queryKey: ["dialogs-archive", host.id, params.workspaceId],
    queryFn: () => getArchive({ workspaceId: params.workspaceId ?? "" }),
    enabled: !!params.workspaceId,
    staleTime: 30_000,
  });
  const times = useQuery<Record<string, string>>({
    queryKey: ["dialogs-activity", host.id], queryFn: async () => ({}),
    initialData: {}, staleTime: Infinity,
  }).data;
  const [query, setQuery] = useState("");
  const list =
    (archive.data?.agents.filter(
      (a) =>
        a.workspaceId === params.workspaceId &&
        a.archivedAt &&
        (a.title ?? "").toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) ?? []).sort((a, b) =>
      (latest(times[b.id], b.lastActivityAt, b.lastUserMessageAt) ?? b.createdAt).localeCompare(
        latest(times[a.id], a.lastActivityAt, a.lastUserMessageAt) ?? a.createdAt,
      ),
    );
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
            time={times[a.id]}
            theme={theme}
            onPress={async () => {
              if (!await openArchivedAgent(a.id, a.workspaceId ?? undefined)) navigation?.openAgent({ agentId: a.id });
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}
