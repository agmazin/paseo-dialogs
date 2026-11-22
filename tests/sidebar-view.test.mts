import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync("client/sidebar.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports: any = {};
function Dialogs(props: any) { return React.createElement("Tree", props); }
new Function("exports", "require", source)(exports, (id: string) => {
  if (id === "react-native") return { View: "View" };
  if (id === "@getpaseo/plugin/client/react-native") return { Modal: "Modal" };
  if (id === "../shared/settings") return { sidebarVisibility: {} };
  if (id === "./dialogs") return { Dialogs };
  return require(id);
});

test("selection moves the single tree into the full view and the switch restores Workspaces", async () => {
  let header: any, view: any, receive: any;
  let removed = 0;
  const release = Object.assign(() => {}, { ready: Promise.resolve() });
  const cleanup = exports.registerSidebar({
    openScreen() {},
    addSidebarHeaderItem(item: any) { header = item.Component; return () => {}; },
    addSidebarView(item: any) { view = item.Component; return () => { view = undefined; removed++; }; },
    subscribe(_contract: any, _input: any, next: any) { receive = next; return release; },
  });
  const host = { id: "mac", label: "Mac" }, layout = { compact: true, platform: "android" };
  const tree = (selected: boolean) => React.createElement(React.Fragment, {},
    React.createElement(header, { host, layout }),
    selected && view ? React.createElement(view, { layout, theme: {}, dismiss() {} }) : null);
  let root!: ReactTestRenderer;
  receive({ host, showNativeWorkspaces: false });
  const selectedView = view;
  receive({ host, showNativeWorkspaces: false });
  assert.equal(view, selectedView);
  await act(() => { root = create(tree(false)); });
  await act(() => root.update(tree(true)));
  const [row] = root.root.findAllByType(Dialogs);
  assert.equal(root.root.findAllByType(Dialogs).length, 1);
  assert.equal(row.props.fill, true);
  assert.equal(row.props.host.id, "mac");
  receive({ host, showNativeWorkspaces: true });
  assert.equal(view, undefined);
  await act(() => root.update(tree(true)));
  assert.equal(root.root.findAllByType(Dialogs).length, 1);
  assert.equal(root.root.findByType(Dialogs).props.fill, undefined);
  receive({ host, showNativeWorkspaces: false });
  await act(() => root.update(tree(true)));
  assert.equal(root.root.findByType(Dialogs).props.fill, true);
  await act(() => root.unmount());
  cleanup();
  assert.equal(removed, 2);
});

test("older clients keep the existing sidebar header", () => {
  let header: any;
  exports.registerSidebar({ addSidebarHeaderItem(item: any) { header = item.Component; return () => {}; } });
  assert.equal(header, Dialogs);
});
