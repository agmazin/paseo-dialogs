import { useLayoutEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import { View } from "react-native";
import type { PluginClientContext, PluginPopoverProps, PluginSidebarItemProps, PluginSidebarViewProps } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { sidebarVisibility } from "../shared/settings";
import { Dialogs } from "./dialogs";

function SidebarView({ theme, layout, dismiss, host, open, mount }: PluginSidebarViewProps & {
  host: PluginSidebarItemProps["host"];
  open: PluginSidebarItemProps["openScreen"];
  mount: () => () => void;
}) {
  const [Menu, setMenu] = useState<ComponentType<PluginPopoverProps> | null>(null);
  useLayoutEffect(mount, [mount]);
  const close = () => setMenu(null);
  const openScreen: PluginSidebarItemProps["openScreen"] = input => {
    close();
    if (layout.compact) dismiss();
    open(input);
  };
  return <View testID="dialogs-sidebar-view" style={{ flex: 1, minHeight: 0 }}>
    <Dialogs theme={theme} host={host} layout={layout} fill currentScreen={null}
      openScreen={openScreen} openPopover={content => setMenu(() => content)} />
    {Menu && <Modal title="Диалоги" open onOpenChange={visible => { if (!visible) close(); }}>
      <Modal.Content>
        <Menu theme={theme} host={host} layout={layout} close={close} openScreen={openScreen} />
      </Modal.Content>
    </Modal>}
  </View>;
}

export function registerSidebar(client: PluginClientContext) {
  const item = { id: "dialogs", title: "Диалоги" };
  if (!sidebarVisibility || typeof client.addSidebarView !== "function" || typeof client.subscribe !== "function") {
    return client.addSidebarHeaderItem({ ...item, Component: Dialogs });
  }
  // The host keeps its header mounted when a custom view replaces Workspaces.
  const listeners = new Set<() => void>();
  let mounted = 0;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const hasView = () => mounted > 0;
  const mount = () => {
    mounted++;
    listeners.forEach(notify => notify());
    return () => { mounted--; listeners.forEach(notify => notify()); };
  };
  function Header(props: PluginSidebarItemProps) {
    return useSyncExternalStore(subscribe, hasView) ? null : <Dialogs {...props} />;
  }
  const removeHeader = client.addSidebarHeaderItem({ ...item, Component: Header });
  let removeView: ReturnType<PluginClientContext["addSidebarView"]> | undefined;
  const clearView = () => { void removeView?.(); removeView = undefined; };
  const stream = client.subscribe(sidebarVisibility, {}, ({ host, showNativeWorkspaces }) => {
    if (showNativeWorkspaces) { clearView(); return; }
    removeView ??= client.addSidebarView({ ...item, Component: props =>
      <SidebarView {...props} host={host} open={client.openScreen} mount={mount} /> });
  }, { onClosed: clearView });
  void stream.ready.catch(clearView);
  return () => { stream(); clearView(); void removeHeader(); };
}
