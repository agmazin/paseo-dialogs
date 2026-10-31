import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

export function sidebarClient() {
  const require = createRequire(import.meta.url);
  const { QueryClient, QueryObserver } = require("@tanstack/react-query");
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const calls: string[] = [];
  let fail = false;
  let restoring = false;
  let finishRestore: (() => void) | undefined;
  let hostStatus = "online";
  let stateGate: Promise<void> | undefined;
  let resumeState: (() => void) | undefined;
  let observer: any;
  let unsubscribe: (() => void) | undefined;
  let cursor = 0;
  const effects: { deps: any[]; cleanup?: () => void }[] = [];
  const pending: (() => void)[] = [];
  const api = {
    agents: { subscribe: () => () => {} },
    workspaces: {
      subscribe: () => () => {},
      list: async () => { calls.push("workspaces"); return { entries: [{ id: "w" }], pageInfo: {} }; },
    },
    terminals: { list: async () => { calls.push("terminals"); return { entries: [] }; } },
  };
  const state = () => ({ groupOrder: ["w"], collapsed: {}, archives: {}, unread: { a: restoring ? "token" : "" }, restoring });
  const cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const exports: any = {};
    cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("exports", "require", code)(exports, (id: string) => {
      if (id === "react") return { useEffect: (fn: () => (() => void) | undefined, deps: any[]) => {
        const slot = cursor++;
        const old = effects[slot];
        if (old && deps.every((value, index) => value === old.deps[index])) return;
        pending.push(() => { old?.cleanup?.(); effects[slot] = { deps, cleanup: fn() }; });
      } };
      if (id === "@getpaseo/plugin") return { defineRpc: (value: any) => value };
      if (id === "@getpaseo/plugin/client") return {
        usePaseo: () => api,
        useHosts: () => [{ serverId: "h", status: hostStatus }],
        useRpc: (contract: any) => rpc[contract.name],
      };
      if (id === "@tanstack/react-query") return {
        useQueryClient: () => queries,
        useQuery: (options: any) => {
          if (!observer) {
            observer = new QueryObserver(queries, options);
            unsubscribe = observer.subscribe(() => {});
          } else observer.setOptions(options);
          return observer.getCurrentResult();
        },
      };
      if (id.startsWith(".")) return load(resolve(dirname(file), `${id}.ts`));
      return require(id);
    });
    return exports;
  };
  const rpc: Record<string, (input: any) => Promise<any>> = {
    "dialogs.state": async (input) => {
      calls.push(input.waitForRestore ? "state-wait" : "state");
      if (fail) throw new Error("offline fixture");
      if (!input.waitForRestore) await stateGate;
      if (input.waitForRestore && restoring) {
        await new Promise<void>((resolve) => { finishRestore = resolve; });
      }
      return state();
    },
    "dialogs.agents": async () => { calls.push("agents"); return { agents: [], archiveCounts: {} }; },
  };
  const client = load(resolve("client/data.ts"));
  return {
    calls, queries,
    render: () => { cursor = 0; const result = client.useData("h"); pending.splice(0).forEach((fn) => fn()); return result; },
    setFailure: (value: boolean) => { fail = value; },
    pause: () => { stateGate = new Promise<void>((resolve) => { resumeState = resolve; }); },
    resume: () => { stateGate = undefined; resumeState?.(); },
    setRestoring: (value: boolean) => { restoring = value; },
    finish: () => { restoring = false; finishRestore?.(); },
    connect: (value: boolean) => { hostStatus = value ? "online" : "offline"; },
    refetch: () => observer.refetch(),
    dispose: () => { effects.forEach((effect) => effect.cleanup?.()); unsubscribe?.(); queries.clear(); },
    subscribeOnce: client.subscribeOnce,
  };
}
