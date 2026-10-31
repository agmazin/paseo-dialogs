import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

export async function sidebarRuntime(options: {
  unread?: Record<string, string>;
  read?: (id: string) => Promise<any>;
  source?: string;
} = {}) {
  const home = await mkdtemp(join(tmpdir(), "dialogs-load-"));
  const before = process.env.PASEO_HOME;
  process.env.PASEO_HOME = home;
  const directory = join(home, "plugin-data/paseo-dialogs");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "state.json"), JSON.stringify({ groupOrder: ["w"],
    collapsed: {}, archives: {}, unread: options.unread ?? {}, candidates: {}, actions: {}, turns: {} }));
  const require = createRequire(import.meta.url);
  const cache = new Map<string, any>();
  const root = resolve("server/runtime.ts");
  const handlers = new Map<string, any>();
  const appends: any[] = [];
  const errors: string[] = [];
  let reads = 0;
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const exports: any = {};
    cache.set(file, exports);
    const code = ts.transpileModule(file === root && options.source ? options.source : readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function("exports", "require", "console", code)(exports, (id: string) => {
      if (id === "@getpaseo/plugin") return { defineRpc: (value: any) => value };
      if (id.startsWith(".")) return load(resolve(dirname(file), `${id}.ts`));
      return require(id);
    }, { log: () => {}, error: (text: string) => errors.push(text) });
    return exports;
  };
  const paseo = {
    workspaces: { list: async () => ({ entries: [{ id: "w" }], pageInfo: {} }) },
    agents: {
      list: async () => ({ entries: [], pageInfo: {} }),
      ref: (id: string) => ({ timeline: {
        refetch: async () => { reads++; return options.read ? options.read(id) : { entries: [] }; },
        append: async (item: any) => { appends.push(item); },
      } }),
    },
  };
  const stop = load(root).register({
    before: () => () => {}, on: () => () => {},
    handle: (contract: any, handler: any) => handlers.set(contract.name, handler),
  });
  if (before === undefined) delete process.env.PASEO_HOME; else process.env.PASEO_HOME = before;
  return {
    appends, errors, get reads() { return reads; },
    call: (name: string, input = {}) => handlers.get(`dialogs.${name}`)(input, { paseo }),
    stop,
    close: async () => { await stop(); await rm(home, { recursive: true, force: true }); },
  };
}
