import { Platform } from "react-native";
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

declare const window: { paseoDesktop?: unknown };
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
