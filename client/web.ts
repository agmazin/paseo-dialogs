import { Alert, Platform } from "react-native";
// DOM is restricted to this module; RN clients acknowledge a mounted tail marker.
declare const document: {
  visibilityState: string;
  addEventListener(name: string, fn: () => void): void;
  removeEventListener(name: string, fn: () => void): void;
};
declare const IntersectionObserver: new (
  fn: (entries: { isIntersecting: boolean }[]) => void,
  options?: { threshold: number },
) => { observe(node: unknown): void; disconnect(): void };
export function observeTail(node: unknown, read: () => void) {
  if (Platform.OS !== "web") {
    read();
    return () => {};
  }
  if (!node || typeof IntersectionObserver === "undefined") return () => {};
  let visible = false;
  const check = () => {
    if (visible && document.visibilityState === "visible") read();
  };
  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries.some((e) => e.isIntersecting);
      check();
    },
    { threshold: 0 },
  );
  observer.observe(node);
  document.addEventListener("visibilitychange", check);
  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", check);
  };
}

declare const window: {
  paseoDesktop?: { dialog?: { ask?: (message: string, options: { title: string; okLabel: string; cancelLabel: string; kind: string }) => Promise<boolean> } };
  location: { pathname: string; search: string };
  confirm?: (message: string) => boolean;
};
export function hasBrowser() {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    !!window.paseoDesktop
  );
}

import { createElement } from "react";
import { providerPaths } from "./provider-paths";
export function providerSvg(provider: string, size: number, color: string) {
  if (Platform.OS !== "web" || !providerPaths[provider]) return null;
  return createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: color,
      fillRule: provider === "codex" ? "evenodd" : undefined,
      "aria-hidden": true,
    },
    createElement("path", { d: providerPaths[provider] }),
  );
}

// Paseo 0.12 exposes selection through accessible native tab elements, not SDK.
// Read-only DOM adapter; never modifies the host tree.
export function observeSelectedTab(onChange: (id: string | null) => void) {
  if (Platform.OS !== "web") return () => {};
  const doc = document as unknown as {
    body: unknown;
    querySelectorAll(selector: string): Iterable<{
      getAttribute(name: string): string | null;
      getClientRects(): { length: number };
    }>;
  };
  const read = () => {
    const tab = [...doc.querySelectorAll('[data-testid^="workspace-tab-"][aria-selected="true"]')]
      .find((node) => node.getClientRects().length > 0);
    onChange(tab?.getAttribute("data-testid")?.replace(/^workspace-tab-(agent|terminal)_/, "") ?? null);
  };
  const observer = new MutationObserver(read);
  observer.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["aria-selected", "style"], childList: true });
  read();
  return () => observer.disconnect();
}
declare const MutationObserver: new (fn: () => void) => {
  observe(node: unknown, options: unknown): void;
  disconnect(): void;
};

export function isNavigationScreenActive(params: Record<string, string | undefined>) {
  if (Platform.OS !== "web") return true;
  if (!window.location.pathname.endsWith("/surface/navigate")) return false;
  const query = Object.fromEntries(window.location.search.slice(1).split("&").map(pair => {
    const [key, value = ""] = pair.split("=");
    return [decodeURIComponent(key), decodeURIComponent(value.replace(/\+/g, " "))];
  }));
  return Object.entries(params).every(([key, value]) => query[`param.${key}`] === value);
}

// After openWorkspace, activate the terminal's native accessible tab if present.
// Missing/closed tabs and non-web hosts keep the documented workspace fallback.
export async function activateTerminalTab(id: string) {
  if (Platform.OS !== "web" || !/^[a-zA-Z0-9_-]+$/.test(id)) return false;
  const doc = document as unknown as {
    querySelectorAll(selector: string): Iterable<{ getClientRects(): {length: number}; click(): void }>;
  };
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const tab = [...doc.querySelectorAll(`[data-testid="workspace-tab-terminal_${id}"]`)]
      .find(node => node.getClientRects().length > 0);
    if (tab) { tab.click(); return true; }
  }
  return false;
}

export function menuAnchor(event: unknown): { x: number; y: number } | undefined {
  if (Platform.OS !== "web") return undefined;
  const rect = (event as { currentTarget?: { getBoundingClientRect?: () => {left: number; top: number} } }).currentTarget?.getBoundingClientRect?.();
  return rect ? { x: rect.left, y: rect.top } : undefined;
}

interface SidebarElement {
  parentElement: SidebarElement | null;
  style: {
    getPropertyValue(name: string): string;
    getPropertyPriority(name: string): string;
    setProperty(name: string, value: string, priority?: string): void;
    removeProperty(name: string): void;
  };
  querySelector(selector: string): SidebarElement | null;
  contains(node: SidebarElement): boolean;
}

// Fail open when native markers or their safe section boundary disappear.
export function hideNativeWorkspaces(enabled: boolean) {
  if (Platform.OS !== "web" || !enabled) return () => {};
  const doc = document as unknown as {
    body: SidebarElement;
    querySelectorAll(selector: string): Iterable<SidebarElement>;
  };
  const hidden = new Map<SidebarElement, { value: string; priority: string }>();
  const restore = (node: SidebarElement) => {
    const previous = hidden.get(node);
    if (!previous) return;
    if (previous.value) node.style.setProperty("display", previous.value, previous.priority);
    else node.style.removeProperty("display");
    hidden.delete(node);
  };
  const reconcile = () => {
    const targets = new Set<SidebarElement>();
    for (const list of doc.querySelectorAll('[data-testid="sidebar-project-workspace-list-scroll"]')) {
      let section: SidebarElement | null = list;
      for (let depth = 0; section && depth < 5; depth++, section = section.parentElement) {
        if (section.querySelector('[data-testid="dialogs-block"], [data-testid="sidebar-footer"], [data-testid^="plugin-sidebar-"]')) break;
        if (section.querySelector('[data-testid="sidebar-display-preferences-menu"]')) {
          targets.add(section);
          break;
        }
      }
    }
    for (const node of hidden.keys()) if (!targets.has(node)) restore(node);
    for (const node of targets) {
      if (!hidden.has(node)) hidden.set(node, {
        value: node.style.getPropertyValue("display"),
        priority: node.style.getPropertyPriority("display"),
      });
      if (node.style.getPropertyValue("display") !== "none" || node.style.getPropertyPriority("display") !== "important") {
        node.style.setProperty("display", "none", "important");
      }
    }
  };
  const observer = new MutationObserver(reconcile);
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-testid", "id", "style"] });
  reconcile();
  return () => {
    observer.disconnect();
    for (const node of hidden.keys()) restore(node);
  };
}

// Paseo 0.12's web DraggableList uses dnd-kit, which is not a plugin runtime
// module. Match its mouse sensor (6px), closest-center vertical sorting, 1.02
// scale, .9 opacity and 200ms ease transition on our own subtree only.
interface DragElement {
  parentElement: DragElement | null;
  style: { transform: string; transition: string; opacity: string; zIndex: string; outline?: string; backgroundColor?: string; borderRadius?: string; boxShadow?: string };
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { top: number; height: number; left: number; width: number };
  closest(selector: string): DragElement | null;
  querySelectorAll(selector: string): Iterable<DragElement>;
  contains(node: DragElement): boolean;
  addEventListener(name: string, handler: (event: DragEvent) => void, capture?: boolean): void;
  removeEventListener(name: string, handler: (event: DragEvent) => void, capture?: boolean): void;
}

export function hasOpenAgentTab(id: string) {
  if (Platform.OS !== "web") return false;
  const doc = document as unknown as DragElement;
  return [...doc.querySelectorAll('[data-testid^="workspace-tab-agent_"]')]
    .some(el => el.getAttribute("data-testid") === `workspace-tab-agent_${id}`);
}

export function bindDialogDrag(node: unknown, hover: string, background: string,
  onDrop: (agentId: string, targetId: string) => void,
  canMove: (agentId: string) => boolean) {
  if (Platform.OS !== "web" || !node) return () => {};
  const root = node as DragElement, doc = document as unknown as DragElement, win = window as unknown as DragElement;
  let drag: { row: DragElement; group: DragElement; groupZ: string; id: string; source: string; x: number; y: number; pointer: number;
    active: boolean; target?: string; style: DragElement["style"]; highlights: [DragElement, Partial<DragElement["style"]>][]; children: [DragElement, Partial<DragElement["style"]>][]; top: number } | undefined;
  let swallow = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopClick = (e: DragEvent) => { if (swallow) { e.preventDefault(); e.stopImmediatePropagation(); } };
  const clearClick = () => { swallow = false; doc.removeEventListener("click", stopClick, true); };
  const finish = (commit: boolean) => {
    const d = drag; if (!d) return;
    drag = undefined;
    Object.assign(d.row.style, d.style);
    d.group.style.zIndex = d.groupZ;
    d.children.forEach(([el, style]) => Object.assign(el.style, style));
    d.highlights.forEach(([el, style]) => Object.assign(el.style, style));
    if (d.active) timer = setTimeout(clearClick, 0);
    if (commit && d.target) onDrop(d.id, d.target);
  };
  const down = (e: DragEvent) => {
    if (e.button !== 0 || e.pointerType !== "mouse" || drag) return;
    const row = e.target.closest('[data-testid^="dialogs-agent-"]');
    const group = row?.closest('[data-testid^="dialogs-group-wks_"]');
    if (!row || !group || !root.contains(row)) return;
    clearTimeout(timer); clearClick();
    drag = { row, group, groupZ: group.style.zIndex, id: row.getAttribute("data-testid")!.slice(14),
      source: group.getAttribute("data-testid")!.slice(14),
      x: e.clientX, y: e.clientY, pointer: e.pointerId, active: false,
      style: { transform: row.style.transform, opacity: row.style.opacity,
        transition: row.style.transition, zIndex: row.style.zIndex, backgroundColor: row.style.backgroundColor, borderRadius: row.style.borderRadius }, highlights: [],
      top: row.getBoundingClientRect().top, children: [...row.querySelectorAll('[role="button"]')].map(el => [el, { backgroundColor: el.style.backgroundColor, outline: el.style.outline, boxShadow: el.style.boxShadow }]) };
  };
  const move = (e: DragEvent) => {
    const d = drag; if (!d || d.pointer !== e.pointerId) return;
    const delta = e.clientY - d.y;
    if (!d.active && Math.hypot(e.clientX - d.x, delta) <= 6) return;
    if (!d.active) {
      d.active = true; swallow = true; doc.addEventListener("click", stopClick, true);
      if (!canMove(d.id)) { finish(false); return; }
    }
    e.preventDefault();
    d.group.style.zIndex = "1000";
    Object.assign(d.row.style, { transform: `translate3d(0px, ${delta}px, 0px) scale(1.02)`,
      transition: "none", opacity: "0.9", zIndex: "1000", backgroundColor: background, borderRadius: "9px" });
    d.children.forEach(([el]) => Object.assign(el.style, { backgroundColor: background, outline: "none", boxShadow: "none" }));
    d.highlights.forEach(([el, style]) => Object.assign(el.style, style));
    d.highlights = []; d.target = undefined;
    for (const group of root.querySelectorAll('[data-testid^="dialogs-group-wks_"]')) {
      const id = group.getAttribute("data-testid")!.slice(14), r = group.getBoundingClientRect();
      if (id !== d.source && e.clientY >= r.top && e.clientY <= r.top + r.height &&
          e.clientX >= r.left && e.clientX <= r.left + r.width) {
        d.target = id;
        for (const el of [group, ...group.querySelectorAll('[role="button"]')]) {
          d.highlights.push([el, { backgroundColor: el.style.backgroundColor, borderRadius: el.style.borderRadius }]);
          Object.assign(el.style, { backgroundColor: hover, borderRadius: "9px" });
        }
        const header = [...group.querySelectorAll('[data-testid="dialogs-group-handle"]')][0];
        if (header) {
          const h = header.getBoundingClientRect();
          const offset = Math.max(delta, h.top + h.height + 4 - d.top);
          d.row.style.transform = `translate3d(0px, ${offset}px, 0px) scale(1.02)`;
        }
        break;
      }
    }
  };
  const up = (e: DragEvent) => { if (drag?.pointer === e.pointerId) finish(true); };
  const cancel = () => finish(false);
  const key = (e: DragEvent) => { if (e.key === "Escape" && drag) { e.preventDefault(); e.stopPropagation(); cancel(); } };
  const selection = (e: DragEvent) => { if (drag?.active) e.preventDefault(); };
  root.addEventListener("pointerdown", down);
  doc.addEventListener("pointermove", move); doc.addEventListener("pointerup", up);
  doc.addEventListener("pointercancel", cancel); doc.addEventListener("keydown", key, true);
  doc.addEventListener("selectstart", selection); win.addEventListener("blur", cancel);
  return () => {
    cancel(); root.removeEventListener("pointerdown", down);
    doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", cancel); doc.removeEventListener("keydown", key, true);
    doc.removeEventListener("selectstart", selection); win.removeEventListener("blur", cancel);
    if (!swallow) clearClick();
  };
}
interface DragEvent {
  target: DragElement;
  button: number;
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  key: string;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}
export function bindGroupDrag(node: unknown, onMove: (id: string, beforeId: string | null) => void) {
  if (Platform.OS !== "web" || !node) return () => {};
  const root = node as DragElement;
  const doc = document as unknown as DragElement;
  const win = window as unknown as DragElement;
  let drag: { elements: DragElement[]; rects: { top: number; height: number }[];
    styles: DragElement["style"][]; from: number; to: number; x: number; y: number;
    pointerId: number; active: boolean } | undefined;
  let swallowClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  const stopClick = (e: DragEvent) => {
    if (swallowClick) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  const clearClick = () => {
    swallowClick = false;
    doc.removeEventListener("click", stopClick, true);
  };
  const finish = (commit: boolean) => {
    const current = drag;
    if (!current) return;
    drag = undefined;
    current.elements.forEach((el, i) => Object.assign(el.style, current.styles[i]));
    if (current.active) {
      // Leave capture installed through the pointerup-generated click.
      clickTimer = setTimeout(clearClick, 0);
      if (commit && current.from !== current.to) {
        const ids = current.elements.map(el => el.getAttribute("data-testid")!.slice("dialogs-group-".length));
        const id = ids.splice(current.from, 1)[0];
        onMove(id, ids[current.to] ?? null);
      }
    }
  };
  const down = (e: DragEvent) => {
    if (e.button !== 0 || e.pointerType !== "mouse" || drag) return;
    const handle = e.target.closest('[data-testid="dialogs-group-handle"]');
    if (!handle || !root.contains(handle) || e.target.closest('[data-testid="dialogs-no-drag"]')) return;
    const group = handle.parentElement;
    const elements = [...root.querySelectorAll('[data-testid^="dialogs-group-"]')]
      .filter(el => el.getAttribute("data-testid") !== "dialogs-group-handle");
    const from = elements.indexOf(group!);
    if (from < 0 || elements.length < 2) return;
    clearTimeout(clickTimer);
    clearClick();
    drag = { elements, from, to: from, x: e.clientX, y: e.clientY, pointerId: e.pointerId, active: false,
      rects: elements.map(el => el.getBoundingClientRect()),
      styles: elements.map(el => ({ transform: el.style.transform, transition: el.style.transition,
        opacity: el.style.opacity, zIndex: el.style.zIndex })) };
  };
  const move = (e: DragEvent) => {
    const d = drag;
    if (!d || d.pointerId !== e.pointerId) return;
    const delta = e.clientY - d.y;
    if (!d.active && Math.hypot(e.clientX - d.x, delta) <= 6) return;
    d.active = true;
    swallowClick = true;
    doc.addEventListener("click", stopClick, true);
    e.preventDefault();
    const active = d.rects[d.from];
    const center = active.top + active.height / 2 + delta;
    d.to = d.rects.reduce((best, r, i) => Math.abs(r.top + r.height / 2 - center) <
      Math.abs(d.rects[best].top + d.rects[best].height / 2 - center) ? i : best, 0);
    d.elements.forEach((el, i) => {
      let offset = 0;
      if (i === d.from) offset = delta;
      else if (d.from < d.to && i > d.from && i <= d.to) offset = -active.height;
      else if (d.from > d.to && i >= d.to && i < d.from) offset = active.height;
      el.style.transform = `translate3d(0px, ${offset}px, 0px)${i === d.from ? " scale(1.02)" : ""}`;
      el.style.transition = i === d.from ? "none" : "transform 200ms ease";
      el.style.opacity = i === d.from ? "0.9" : "1";
      el.style.zIndex = i === d.from ? "1000" : "1";
    });
  };
  const up = (e: DragEvent) => { if (drag?.pointerId === e.pointerId) finish(true); };
  const cancel = () => finish(false);
  const key = (e: DragEvent) => { if (e.key === "Escape" && drag) { e.preventDefault(); e.stopPropagation(); cancel(); } };
  const selection = (e: DragEvent) => { if (drag?.active) e.preventDefault(); };
  root.addEventListener("pointerdown", down);
  doc.addEventListener("pointermove", move);
  doc.addEventListener("pointerup", up);
  doc.addEventListener("pointercancel", cancel);
  doc.addEventListener("keydown", key, true);
  doc.addEventListener("selectstart", selection);
  win.addEventListener("blur", cancel);
  return () => {
    cancel();
    root.removeEventListener("pointerdown", down);
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", cancel);
    doc.removeEventListener("keydown", key, true);
    doc.removeEventListener("selectstart", selection);
    win.removeEventListener("blur", cancel);
    if (!swallowClick) clearClick();
  };
}

// Same backends as the host confirmDialog: Alert on phones, Electron ask, browser confirm.
export async function confirmDestructive(input: { title: string; message: string; confirm: string; cancel: string }) {
  if (Platform.OS !== "web") return new Promise<boolean>(resolve => Alert.alert(input.title, input.message, [
    { text: input.cancel, style: "cancel", onPress: () => resolve(false) },
    { text: input.confirm, style: "destructive", onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
  const ask = window.paseoDesktop?.dialog?.ask;
  if (typeof ask === "function") return ask(input.message, {
    title: input.title, okLabel: input.confirm, cancelLabel: input.cancel, kind: "warning",
  });
  return !!window.confirm?.(`${input.title}\n\n${input.message}`);
}

// Right click on a group row opens the same menu as its "..." button.
export function bindGroupMenu(node: unknown, onMenu: (id: string, anchor: { x: number; y: number }) => void) {
  if (Platform.OS !== "web" || !node) return () => {};
  const root = node as DragElement;
  const open = (e: DragEvent) => {
    const handle = e.target.closest('[data-testid="dialogs-group-handle"]');
    const id = handle?.parentElement?.getAttribute("data-testid")?.slice("dialogs-group-".length);
    if (!handle || !root.contains(handle) || !id) return;
    e.preventDefault();
    onMenu(id, { x: e.clientX, y: e.clientY - 30 });
  };
  root.addEventListener("contextmenu", open);
  return () => root.removeEventListener("contextmenu", open);
}

export function isWorkspaceRouteOpen(id: string) {
  return Platform.OS === "web" && typeof window !== "undefined" &&
    window.location.pathname.split("/").includes(id);
}
