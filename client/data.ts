import { useEffect } from "react";
import { usePaseo, useRpc, useHosts } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaseoApi, PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import type { z } from "zod";
import { readAgents, readState, type SlimAgent, type stateSchema } from "../shared/contracts";
import { latest, slim, topLevel } from "../shared/model";
import { boundedLoad, dialogLoadState } from "./loading";
export async function agents(paseo: PaseoApi, includeChildren = false) {
  let cursor: string | undefined;
  const all: PaseoAgent[] = [];
  do {
    const result = await paseo.agents.list({
      filter: { includeArchived: true },
      page: { limit: 200, cursor },
    });
    all.push(...result.entries.map((e) => e.agent));
    cursor = result.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return all.filter(a => includeChildren || topLevel(a)).sort((a, b) => (b.lastUserMessageAt ?? b.createdAt).localeCompare(a.lastUserMessageAt ?? a.createdAt));
}
async function workspaces(paseo: PaseoApi, signal?: AbortSignal) {
  let cursor: string | undefined;
  const all: PaseoWorkspace[] = [];
  do {
    if (signal?.aborted) throw new Error("Dialog loading cancelled");
    const r = await paseo.workspaces.list({ page: { limit: 200, cursor } });
    if (signal?.aborted) throw new Error("Dialog loading cancelled");
    all.push(...r.entries);
    cursor = r.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return all.filter((w) => !w.background && !w.archivingAt);
}
type Data = {
  agents: SlimAgent[];
  archiveCounts: Record<string, number>;
  workspaces: PaseoWorkspace[];
  terminals: Awaited<ReturnType<PaseoApi["terminals"]["list"]>>["entries"];
  state: z.output<typeof stateSchema>;
};
const byActivity = (a: SlimAgent, b: SlimAgent) =>
  (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt);

// The phone talks to the Mac through the relay. Agent rows are built on the Mac (slim, about
// 15 fields); events of the plugin's single subscriptions (opened in the client entry) patch the
// cache; a full refetch runs once a minute.
export function useData(hostId: string) {
  const paseo = usePaseo();
  const qc = useQueryClient();
  const getState = useRpc(readState);
  const getAgents = useRpc(readAgents);
  const key = ["dialogs", hostId];
  const connected = useHosts().some((host) => host.serverId === hostId && host.status === "online");
  const query = useQuery({
    queryKey: key,
    enabled: connected,
    retry: false,
    queryFn: ({ signal }): Promise<Data> => boundedLoad(async (lifetime) => {
      const state = getState({});
      const rows = state.then((s) => {
        if (lifetime.aborted) throw new Error("Dialog loading cancelled");
        const archives = Object.keys(s.archives).filter((id) => s.archives[id]);
        return getAgents({ archives, limit: 30 });
      });
      const [s, a, w, t] = await Promise.all([state, rows, workspaces(paseo, lifetime), paseo.terminals.list()]);
      return { agents: a.agents.sort(byActivity), archiveCounts: a.archiveCounts, workspaces: w, terminals: t.entries, state: s };
    }, signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (!query.data?.state.restoring || !connected) return;
    const lifetime = new AbortController();
    void boundedLoad(() => getState({ waitForRestore: true }), lifetime.signal, 12000)
      .then((state) => qc.setQueryData<Data>(key, (old) => old ? { ...old, state } : old))
      .catch(() => {
        if (!lifetime.signal.aborted) console.warn("Диалоги: фоновое обновление статуса недоступно");
      });
    return () => lifetime.abort();
  }, [query.data?.state.restoring, connected, getState, hostId, qc]);
  useEffect(() => {
    const lifetime = new AbortController();
    let wsTimer: ReturnType<typeof setTimeout> | undefined;
    const patch = (fn: (old: Data) => Data) => {
      if (!lifetime.signal.aborted) qc.setQueryData<Data>(key, (old) => old ? fn(old) : old);
    };
    let reload: ReturnType<typeof setTimeout> | undefined;
    const refetchSoon = () => {
      if (lifetime.signal.aborted) return;
      if (!reload) reload = setTimeout(() => ((reload = undefined), void qc.invalidateQueries({ queryKey: key })), 500);
    };
    const offAgents = paseo.agents.subscribe((update) => {
      if (lifetime.signal.aborted) return;
      const id = update.kind === "upsert" ? update.agent.id : update.agentId;
      const old = qc.getQueryData<Data>(key)?.agents.find((a) => a.id === id);
      // Archiving moves a dialog between the live list and the archive counts: reload the small list.
      if (update.kind === "upsert" && topLevel(update.agent) && !!update.agent.archivedAt !== !!old?.archivedAt) return refetchSoon();
      patch((data) => {
        const rest = data.agents.filter((a) => a.id !== id);
        if (update.kind !== "upsert" || !(topLevel(update.agent) || !update.agent.archivedAt)) return { ...data, agents: rest };
        // Events carry no turn times the server saw: a row's time never goes back.
        const row = slim(update.agent);
        return { ...data, agents: [...rest, { ...row, lastActivityAt: latest(row.lastActivityAt, old?.lastActivityAt) }].sort(byActivity) };
      });
    });
    const offWorkspaces = paseo.workspaces.subscribe(() => {
      if (lifetime.signal.aborted) return;
      if (wsTimer) return;
      wsTimer = setTimeout(() => {
        wsTimer = undefined;
        void workspaces(paseo, lifetime.signal)
          .then((w) => { if (!lifetime.signal.aborted) patch((old) => ({ ...old, workspaces: w })); })
          .catch(() => {});
      }, 300);
    });
    return () => {
      lifetime.abort();
      offAgents();
      offWorkspaces();
      if (wsTimer) clearTimeout(wsTimer);
      if (reload) clearTimeout(reload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paseo, qc, hostId]);
  return { ...query, paseo, loadState: dialogLoadState({ connected, hasData: !!query.data, fetching: query.isFetching, error: query.isError }) };
}

// The plugin's single agent and workspace subscriptions: their events reach every useData
// through paseo.*.subscribe. A subscription per surface made the daemon send each event again.
export function subscribeOnce(paseo: PaseoApi) {
  const lifetime = new AbortController();
  const subscriptions = new Set<{ release(): Promise<void> }>();
  const release = (subscription: { release(): Promise<void> }) => {
    void Promise.resolve().then(() => subscription.release()).catch(() => {});
  };
  const own = (request: Promise<{ subscription: { release(): Promise<void> } }>) => {
    void request.then(({ subscription }) => {
      if (lifetime.signal.aborted) release(subscription);
      else subscriptions.add(subscription);
    }).catch(() => {});
  };
  own(paseo.agents.list({ filter: { includeArchived: true }, page: { limit: 1 }, subscribe: {}, signal: lifetime.signal }));
  own(paseo.workspaces.list({ page: { limit: 1 }, subscribe: {} }));
  return () => {
    lifetime.abort();
    subscriptions.forEach(release);
    subscriptions.clear();
  };
}

// Preference and order RPCs return the whole state: put it into the cache, no refetch.
export function setState(qc: ReturnType<typeof useQueryClient>, hostId: string, state: Data["state"]) {
  qc.setQueryData<Data>(["dialogs", hostId], (old) => (old ? { ...old, state } : old));
}
