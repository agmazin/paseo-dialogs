import { useEffect } from "react";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaseoApi, PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import type { z } from "zod";
import { readState, type stateSchema } from "../shared/contracts";
import { topLevel } from "../shared/model";
export async function agents(paseo: PaseoApi) {
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
  return all.filter(topLevel).sort((a, b) => (b.lastUserMessageAt ?? b.createdAt).localeCompare(a.lastUserMessageAt ?? a.createdAt));
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
  agents: PaseoAgent[];
  workspaces: PaseoWorkspace[];
  terminals: Awaited<ReturnType<PaseoApi["terminals"]["list"]>>["entries"];
  state: z.output<typeof stateSchema>;
};
const byActivity = (a: PaseoAgent, b: PaseoAgent) =>
  (b.lastUserMessageAt ?? b.createdAt).localeCompare(a.lastUserMessageAt ?? a.createdAt);

// The phone talks to the Mac through the relay: refetching every agent with the archive
// (425 agents, 824 KB on 22.10.2026) every few seconds froze the list for up to 20 s.
// Agent and workspace events now patch the cache; a full refetch runs once a minute.
export function useData(hostId: string) {
  const paseo = usePaseo();
  const qc = useQueryClient();
  const getState = useRpc(readState);
  const key = ["dialogs", hostId];
  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<Data> => {
      const [a, w, t, s] = await Promise.all([
        agents(paseo),
        workspaces(paseo),
        paseo.terminals.list(),
        getState({}),
      ]);
      return { agents: a, workspaces: w, terminals: t.entries, state: s };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  useEffect(() => {
    let alive = true;
    const cleanups: (() => void)[] = [];
    let wsTimer: ReturnType<typeof setTimeout> | undefined;
    const patch = (fn: (old: Data) => Data) => qc.setQueryData<Data>(key, (old) => (old ? fn(old) : old));
    const refreshWorkspaces = () => {
      if (wsTimer) return;
      wsTimer = setTimeout(() => {
        wsTimer = undefined;
        void workspaces(paseo)
          .then((w) => patch((old) => ({ ...old, workspaces: w })))
          .catch(() => {});
      }, 300);
    };
    void Promise.allSettled([
      paseo.agents.list({ filter: { includeArchived: true }, page: { limit: 1 }, subscribe: {} }),
      paseo.workspaces.list({ page: { limit: 1 }, subscribe: {} }),
    ])
      .then(([agentList, workspaceList]) => {
        if (agentList.status === "fulfilled") {
          const r = agentList.value;
          if (!alive) r.subscription.release();
          else {
            r.subscription.subscribe({
              snapshot: () => {},
              update: (message) => {
                if (message.type !== "agent_update") return;
                const update = message.payload;
                patch((old) => {
                  const rest = old.agents.filter((a) => a.id !== (update.kind === "upsert" ? update.agent.id : update.agentId));
                  if (update.kind !== "upsert" || !topLevel(update.agent)) return { ...old, agents: rest };
                  return { ...old, agents: [...rest, update.agent].sort(byActivity) };
                });
              },
            });
            cleanups.push(() => r.subscription.release());
          }
        }
        if (workspaceList.status === "fulfilled") {
          const r = workspaceList.value;
          if (!alive) r.subscription.release();
          else {
            r.subscription.subscribe({ snapshot: () => {}, update: refreshWorkspaces });
            cleanups.push(() => r.subscription.release());
          }
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (wsTimer) clearTimeout(wsTimer);
      cleanups.forEach((c) => c());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paseo, qc, hostId]);
  return { ...query, paseo };
}

// Preference and order RPCs return the whole state: put it into the cache, no refetch.
export function setState(qc: ReturnType<typeof useQueryClient>, hostId: string, state: Data["state"]) {
  qc.setQueryData<Data>(["dialogs", hostId], (old) => (old ? { ...old, state } : old));
}
