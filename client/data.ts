import { useEffect } from "react";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaseoApi, PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import type { z } from "zod";
import { readAgents, readState, type SlimAgent, type stateSchema } from "../shared/contracts";
import { latest, slim, topLevel } from "../shared/model";
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
async function workspaces(paseo: PaseoApi) {
  let cursor: string | undefined;
  const all: PaseoWorkspace[] = [];
  do {
    const r = await paseo.workspaces.list({ page: { limit: 200, cursor } });
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
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Data> => {
      // Archived rows only for groups with an open "Архив" (up to 30 each, the list's maximum).
      const s = await getState({});
      const archives = Object.keys(s.archives).filter((id) => s.archives[id]);
      const [a, w, t] = await Promise.all([getAgents({ archives, limit: 30 }), workspaces(paseo), paseo.terminals.list()]);
      return { agents: a.agents.sort(byActivity), archiveCounts: a.archiveCounts, workspaces: w, terminals: t.entries, state: s };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  useEffect(() => {
    let wsTimer: ReturnType<typeof setTimeout> | undefined;
    const patch = (fn: (old: Data) => Data) => qc.setQueryData<Data>(key, (old) => (old ? fn(old) : old));
    let reload: ReturnType<typeof setTimeout> | undefined;
    const refetchSoon = () => {
      if (!reload) reload = setTimeout(() => ((reload = undefined), void qc.invalidateQueries({ queryKey: key })), 500);
    };
    const offAgents = paseo.agents.subscribe((update) => {
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
      if (wsTimer) return;
      wsTimer = setTimeout(() => {
        wsTimer = undefined;
        void workspaces(paseo)
          .then((w) => patch((old) => ({ ...old, workspaces: w })))
          .catch(() => {});
      }, 300);
    });
    return () => {
      offAgents();
      offWorkspaces();
      if (wsTimer) clearTimeout(wsTimer);
      if (reload) clearTimeout(reload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paseo, qc, hostId]);
  return { ...query, paseo };
}

// The plugin's single agent and workspace subscriptions: their events reach every useData
// through paseo.*.subscribe. A subscription per surface made the daemon send each event again.
export function subscribeOnce(paseo: PaseoApi) {
  const releases: (() => void)[] = [];
  let alive = true;
  void Promise.allSettled([
    paseo.agents.list({ filter: { includeArchived: true }, page: { limit: 1 }, subscribe: {} }),
    paseo.workspaces.list({ page: { limit: 1 }, subscribe: {} }),
  ]).then((results) => {
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      if (alive) releases.push(() => r.value.subscription.release());
      else r.value.subscription.release();
    }
  });
  return () => {
    alive = false;
    releases.forEach((r) => r());
  };
}

// Preference and order RPCs return the whole state: put it into the cache, no refetch.
export function setState(qc: ReturnType<typeof useQueryClient>, hostId: string, state: Data["state"]) {
  qc.setQueryData<Data>(["dialogs", hostId], (old) => (old ? { ...old, state } : old));
}
