import { useEffect } from "react";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaseoApi, PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import { readState } from "../shared/contracts";
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
  return all
    .filter(topLevel)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
export function useData(hostId: string) {
  const paseo = usePaseo();
  const qc = useQueryClient();
  const getState = useRpc(readState);
  const query = useQuery({
    queryKey: ["dialogs", hostId],
    queryFn: async () => {
      const [a, w, t, s] = await Promise.all([
        agents(paseo),
        workspaces(paseo),
        paseo.terminals.list(),
        getState({}),
      ]);
      return { agents: a, workspaces: w, terminals: t.entries, state: s };
    },
    refetchInterval: 4000,
  });
  useEffect(() => {
    let alive = true;
    const cleanups: (() => void)[] = [];
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["dialogs", hostId] });
    };
    void Promise.all([
      paseo.agents.list({ filter: { includeArchived: true }, subscribe: {} }),
      paseo.workspaces.list({ subscribe: {} }),
    ])
      .then((results) => {
        for (const r of results) {
          if (!alive) {
            r.subscription.release();
            continue;
          }
          r.subscription.subscribe({ snapshot: refresh, update: refresh });
          cleanups.push(() => r.subscription.release());
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      cleanups.forEach((c) => c());
    };
  }, [paseo, qc, hostId]);
  return { ...query, paseo };
}
