import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  useWindowDimensions,
  Pressable,
  Text,
  TextInput,
  View,
  type ViewStyle,
  type GestureResponderEvent,
} from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { providerSvg, menuAnchor, observeSidebarHeight, setHoverTitle } from "./web";
import { providerIcons } from "./icons";
import { atRest, splitKey } from "../shared/model";
export type MenuAnchor = { x: number; y: number };
function anchor(e: GestureResponderEvent): MenuAnchor | undefined { return menuAnchor(e); }
export type Theme = PluginSidebarItemProps["theme"];
export type Status =
  | "needs_input"
  | "failed"
  | "running"
  | "attention"
  | "done";
export const statusNames = {
  needs_input: "Ожидает ввода",
  failed: "Ошибка",
  running: "В работе",
  attention: "На проверку",
  done: "Готово",
};
export const metrics = {
  group: 34,
  agent: 30,
  archive: 30,
  old: 28,
  more: 28,
  radius: 9,
  indent: 30,
  oldIndent: 44,
  moreIndent: 70,
};
const font =
  "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, system-ui, sans-serif";
function blend(fg: string, bg: string, amount: number) {
  const hex = (c: string) =>
    /^#[\da-f]{6}$/i.test(c)
      ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
      : null;
  const a = hex(fg),
    b = hex(bg);
  return a && b
    ? `#${a
        .map((v, i) =>
          Math.round(v * amount + b[i] * (1 - amount))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`
    : fg;
}
// Every surface is derived from the host theme: Paseo's dark grays are slightly
// green, so neutral mockup grays read as dirty red next to native chrome.
export function palette(theme: Theme) {
  const c = theme.colors;
  const dark = parseInt(c.surface0.slice(1, 3), 16) < 128;
  const bg = c.surface0;
  const menu = c.surface1;
  return {
    dark,
    bg,
    hover: c.surface1,
    active: c.surface2,
    fg: c.foreground,
    muted: c.foregroundMuted,
    dim: blend(c.foregroundMuted, bg, 0.613),
    title: blend(c.foreground, bg, 0.925),
    run: dark ? "#5caaf6" : "#268ae0",
    ok: dark ? "#35c264" : "#299f51",
    warn: dark ? "#db932e" : "#b37824",
    bad: dark ? "#f7796d" : "#f12e2f",
    menu,
    line: dark ? blend(c.foreground, menu, 0.075) : c.border,
    key: c.surface2,
    input: dark ? blend("#000000", bg, 0.12) : bg,
    inputLine: dark ? blend(c.foreground, menu, 0.11) : c.border,
    button: c.surface2,
  };
}
export function Label({
  children,
  color,
  size = 14,
  weight = "400",
  style,
}: {
  children: ReactNode;
  color: string;
  size?: number;
  weight?: "400" | "500" | "600" | "800";
  style?: object;
}) {
  return (
    <Text
      numberOfLines={1}
      style={{
        fontFamily: font,
        color,
        fontSize: size,
        lineHeight: size * 1.35,
        fontWeight: weight,
        ...style,
      }}
    >
      {children}
    </Text>
  );
}
export function ProviderIcon({
  provider,
  theme,
  old = false,
}: {
  provider: string;
  theme: Theme;
  old?: boolean;
}) {
  const p = palette(theme),
    color = old ? p.dim : p.muted;
  return (
    <View style={{ width: 16, height: 16, flexShrink: 0 }}>
      {providerSvg(provider, 16, color) ??
        (providerIcons[provider] ? (
          <Image
            source={{ uri: providerIcons[provider] }}
            style={{ width: 16, height: 16, tintColor: color }}
          />
        ) : (
          <Icon
            name={provider === "terminal" ? "SquareTerminal" : "Bot"}
            size={16}
            color={color}
          />
        ))}
    </View>
  );
}
export function Badge({
  status,
  theme,
  cut,
  mini = false,
}: {
  status: Status;
  theme: Theme;
  cut?: string;
  mini?: boolean;
}) {
  const p = palette(theme),
    spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (status !== "running") return;
    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [spin, status]);
  if (status === "done") return null;
  const need = status === "needs_input",
    size = need ? 12 : mini ? 8 : 7,
    color = need
      ? p.warn
      : status === "running"
        ? p.run
        : status === "failed"
          ? p.bad
          : p.ok;
  const position: ViewStyle = mini
    ? {}
    : { position: "absolute", right: need ? -4 : -2, bottom: need ? -4 : -2 };
  return (
    <View
      accessibilityLabel={statusNames[status]}
      style={{
        width: size,
        height: size,
        borderRadius: 50,
        flexShrink: 0,
        ...position,
      }}
    >
      {!mini && (
        <View
          style={{
            position: "absolute",
            top: -1.6,
            bottom: -1.6,
            left: -1.6,
            right: -1.6,
            borderRadius: 50,
            backgroundColor: cut ?? p.bg,
          }}
        />
      )}
      <View
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 50,
          backgroundColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {need && (
          <Text
            style={{
              fontFamily: font,
              color: theme.colors.surface0,
              fontWeight: "800",
              fontSize: 9,
              lineHeight: 12,
              textAlign: "center",
            }}
          >
            !
          </Text>
        )}
      </View>
      {status === "running" && (
        <Animated.View
          style={{
            position: "absolute",
            top: mini ? -3 : -3.5,
            bottom: mini ? -3 : -3.5,
            left: mini ? -3 : -3.5,
            right: mini ? -3 : -3.5,
            borderRadius: 50,
            borderWidth: mini ? 1.4 : 1.5,
            borderColor: "rgba(92,170,246,.2)",
            borderTopColor: p.run,
            transform: [
              {
                rotate: spin.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", "360deg"],
                }),
              },
            ],
          }}
        />
      )}
    </View>
  );
}
// One running-subagent circle: 5px dot, 10px spinner, its own cut. The parent's pair and every
// subagent row draw this component; the pair shares one spin value, so both turn in phase.
const runSoft = "rgba(92,170,246,.2)";
function useSpin() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: false }),
    );
    animation.start();
    return () => animation.stop();
  }, [spin]);
  return spin;
}
const around = (d: number) => ({ position: "absolute" as const, top: -d, bottom: -d, left: -d, right: -d, borderRadius: 50 });
function Mini({ theme, cut, spin }: { theme: Theme; cut: string; spin: Animated.Value }) {
  const p = palette(theme);
  return (
    <View style={{ width: 5, height: 5 }}>
      <View style={{ ...around(2.5), backgroundColor: cut }} />
      <View style={{ ...around(0), backgroundColor: p.run }} />
      <Animated.View
        style={{
          ...around(2.5),
          borderWidth: 1.2,
          borderColor: runSoft,
          borderTopColor: p.run,
          transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
        }}
      />
    </View>
  );
}
// "pair": parent at rest with working subagents, centers 12.5/15.5 and 19.5/15.5 of the icon.
// "one": a subagent row, center 14.5/14.5 like Badge.
export function SubagentBadge({ theme, cut, pair = false, onPress }: {
  theme: Theme; cut?: string; pair?: boolean; onPress?: () => void;
}) {
  const spin = useSpin(),
    c = cut ?? palette(theme).bg;
  const style: ViewStyle = pair
    ? { position: "absolute", right: -6, bottom: -2, flexDirection: "row", gap: 2 }
    : { position: "absolute", right: -1, bottom: -1 };
  const body = (
    <>
      <Mini theme={theme} cut={c} spin={spin} />
      {pair && <Mini theme={theme} cut={c} spin={spin} />}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Показать подагентов"
      testID="dialogs-subagents-pair"
      onPress={(e) => { e.stopPropagation(); onPress(); }}
      style={style}
    >
      {body}
    </Pressable>
  ) : (
    <View testID={pair ? "dialogs-subagents-pair" : "dialogs-subagent-dot"} accessibilityLabel={statusNames.running} style={style}>
      {body}
    </View>
  );
}
export function Row({
  theme,
  label,
  onPress,
  height = 34,
  indent = 10,
  selected = false,
  children,
  testID,
  hint,
}: {
  theme: Theme;
  label: string;
  onPress: () => void;
  height?: number;
  indent?: number;
  selected?: boolean;
  children: ReactNode | ((cut: string, hover: boolean) => ReactNode);
  testID?: string;
  hint?: string;
}) {
  const [hover, setHover] = useState(false);
  const node = useRef<View>(null);
  useEffect(() => setHoverTitle(node.current, hint), [hint]);
  const p = palette(theme);
  const cut = selected ? p.active : hover ? p.hover : p.bg;
  return (
    <Pressable
      ref={node}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPress={onPress}
      style={{
        height,
        marginHorizontal: 2,
        paddingLeft: indent,
        paddingRight: 10,
        borderRadius: 9,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: cut,
      }}
    >
      {typeof children === "function" ? children(cut, hover) : children}
    </Pressable>
  );
}
export function AgentLine({
  theme,
  title,
  time,
  provider,
  status = "done",
  old = false,
  sub = false,
  subagents = 0,
  open = false,
  onToggle,
  selected = false,
  onPress,
  testID,
}: {
  theme: Theme;
  title: string;
  time: string;
  provider: string;
  status?: Status;
  old?: boolean;
  /** A running subagent under its parent: archive-row geometry, one small circle. */
  sub?: boolean;
  /** Running subagents of a dialog at rest: a pair of circles and a chevron. */
  subagents?: number;
  open?: boolean;
  onToggle?: () => void;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const p = palette(theme);
  const named = splitKey(title);
  const small = old || sub,
    // Permission and error badges stay: they need the user more than working subagents do.
    busy = subagents > 0 && atRest(status);
  return (
    <Row
      testID={testID}
      theme={theme}
      label={title}
      height={small ? 28 : 30}
      indent={small ? 44 : 30}
      selected={selected}
      onPress={onPress}
      hint={busy ? `Работают подагенты: ${subagents}` : undefined}
    >
      {(cut) => (
        <>
          {(open || busy) && onToggle && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={open ? "Скрыть подагентов" : "Показать подагентов"}
              accessibilityState={{ expanded: open }}
              testID="dialogs-subagents-toggle"
              onPress={(e) => { e.stopPropagation(); onToggle(); }}
              style={{ position: "absolute", left: 12, top: 8, width: 14, height: 14,
                alignItems: "center", justifyContent: "center" }}
            >
              <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={p.dim} />
            </Pressable>
          )}
          <View style={{ width: 16, height: 16, flexShrink: 0 }}>
            <ProviderIcon provider={provider} theme={theme} old={old} />
            {sub ? (
              <SubagentBadge theme={theme} cut={cut} />
            ) : busy ? (
              <SubagentBadge theme={theme} cut={cut} pair onPress={onToggle} />
            ) : (
              !old && <Badge theme={theme} status={status} cut={cut} />
            )}
          </View>
          <Label
            color={small ? p.muted : p.title}
            size={small ? 13 : 13.5}
            style={{ flex: 1 }}
          >
            {named.key ? <Text style={{ color: p.dim }}>{named.key} </Text> : null}
            {named.name}
          </Label>
          <Label
            size={12}
            color={p.dim}
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {time}
          </Label>
        </>
      )}
    </Row>
  );
}
export function GroupLine({
  theme,
  name,
  count,
  collapsed,
  counts = {},
  onPress,
  onAdd,
  onMenu,
  compact = false,
}: {
  theme: Theme;
  name: string;
  count: number;
  collapsed: boolean;
  counts?: Partial<Record<Status, number>>;
  onPress: () => void;
  onAdd: (anchor?: MenuAnchor) => void;
  onMenu: (anchor?: MenuAnchor) => void;
  compact?: boolean;
}) {
  const p = palette(theme);
  return (
    <Row testID="dialogs-group-handle" theme={theme} label={`Группа ${name}`} onPress={onPress}>
      {(_cut, hover) => (
        <>
          <Icon
            name={collapsed ? "ChevronRight" : "ChevronDown"}
            size={14}
            color={p.dim}
          />
          <Label weight="500" color={p.fg} style={{ flex: 1 }}>
            {name}
          </Label>
          <View testID="dialogs-no-drag" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {collapsed &&
              (["needs_input", "running", "attention", "failed"] as const).map(
                (s) =>
                  counts[s] ? (
                    <View
                      key={s}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <Badge mini theme={theme} status={s} />
                      <Label color={p.muted} size={12}>
                        {counts[s]}
                      </Label>
                    </View>
                  ) : null,
              )}
            <Label color={p.dim} size={12}>
              {count}
            </Label>
          </View>
          {(
            <Pressable
              accessibilityRole="button"
              testID="dialogs-no-drag"
              accessibilityLabel={`Добавить в ${name}`}
              onPress={(e) => {
                e.stopPropagation();
                onAdd(anchor(e));
              }}
              style={{
                width: 24,
                height: 24,
                display: hover || compact ? "flex" : "none",
                marginLeft: -4,
                marginRight: -6,
                borderRadius: 6,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="Plus" size={15} color={p.muted} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            testID="dialogs-no-drag"
            accessibilityLabel={`Действия группы ${name}`}
            onPress={(e) => {
              e.stopPropagation();
              onMenu(anchor(e));
            }}
            style={{
              width: 24,
              height: 24,
              display: hover || compact ? "flex" : "none",
              marginLeft: -4,
              marginRight: -6,
              borderRadius: 6,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="MoreVertical" size={14} color={p.muted} />
          </Pressable>
        </>
      )}
    </Row>
  );
}
export function ArchiveLine({
  theme,
  count,
  open,
  onPress,
}: {
  theme: Theme;
  count: number;
  open: boolean;
  onPress: () => void;
}) {
  const p = palette(theme);
  return (
    <Row
      theme={theme}
      label={`Архив ${count}`}
      height={30}
      indent={30}
      onPress={onPress}
    >
      <Icon
        name={open ? "ChevronDown" : "ChevronRight"}
        size={14}
        color={p.dim}
      />
      <Label size={13.5} color={p.muted} style={{ flex: 1 }}>
        Архив
      </Label>
      <Label size={12} color={p.dim}>
        {count}
      </Label>
    </Row>
  );
}
export function MoreLine({
  theme,
  label,
  onPress,
}: {
  theme: Theme;
  label: string;
  onPress: () => void;
}) {
  return (
    <Row theme={theme} label={label} height={28} indent={70} onPress={onPress}>
      <Label color={palette(theme).run} size={12.5}>
        {label}
      </Label>
    </Row>
  );
}
export function Block({
  theme,
  children,
  onAdd,
  compact = false,
}: {
  theme: Theme;
  children: ReactNode;
  onAdd: (anchor?: MenuAnchor) => void;
  compact?: boolean;
}) {
  const p = palette(theme);
  // Header items do not scroll with the host list; keep sibling rows and the footer visible.
  const { height } = useWindowDimensions();
  const root = useRef<View>(null);
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);
  useEffect(() => observeSidebarHeight(root.current, setAvailableHeight), []);
  const body = (
    <ScrollView testID="dialogs-scroll" nestedScrollEnabled style={{ minHeight: 0,
      maxHeight: Math.min(Math.round(height * (Platform.OS === "web" ? 0.7 : 0.55)), availableHeight ?? Infinity) }}>
      {children}
    </ScrollView>
  );
  return (
    <View
      ref={root}
      testID="dialogs-block"
      style={{
        marginTop: 8,
        marginHorizontal: 6,
        marginBottom: 4,
        paddingBottom: 6,
        borderWidth: 1,
        borderColor: "transparent",
        borderRadius: 12,
        backgroundColor: p.bg,
      }}
    >
      <View
        style={{
          height: 30,
          marginHorizontal: 2,
          paddingLeft: 10,
          paddingRight: 6,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Label size={13} color={p.muted}>
          Диалоги
        </Label>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Новая папка"
          onPress={(e) => onAdd(anchor(e))}
          style={{
            width: 24,
            height: 24,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
          }}
        >
          <Icon name="Plus" size={15} color={p.dim} />
        </Pressable>
      </View>
      {body}
    </View>
  );
}
export function MenuLine({
  theme,
  label,
  icon,
  keys,
  onPress,
  provider,
}: {
  theme: Theme;
  label: string;
  icon?: string;
  keys?: string;
  onPress: () => void;
  provider?: string;
}) {
  const p = palette(theme);
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPress={onPress}
      style={{
        height: 34,
        paddingHorizontal: 10,
        borderRadius: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: hover ? p.active : "transparent",
      }}
    >
      {provider ? (
        <ProviderIcon provider={provider} theme={theme} />
      ) : icon ? (
        <Icon name={icon} size={17} color={p.muted} />
      ) : null}
      <Label color={p.fg} style={{ flex: 1 }}>
        {label}
      </Label>
      {keys && (
        <View
          style={{
            backgroundColor: p.key,
            paddingVertical: 2,
            paddingHorizontal: 7,
            borderRadius: 6,
          }}
        >
          <Label color={p.muted} size={12} style={{ letterSpacing: 0.5 }}>
            {keys}
          </Label>
        </View>
      )}
    </Pressable>
  );
}
export function GroupMenuView({
  theme,
  onRename,
  onDelete,
}: {
  theme: Theme;
  onRename: () => void;
  onDelete: () => void;
}) {
  const p = palette(theme);
  return (
    <View
      testID="dialogs-group-menu"
      style={{
        width: 260,
        padding: 6,
        backgroundColor: p.menu,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: p.line,
      }}
    >
      <MenuLine theme={theme} label="Переименовать" icon="Pencil" onPress={onRename} />
      <MenuLine theme={theme} label="Удалить группу" icon="Archive" onPress={onDelete} />
    </View>
  );
}
export function MenuView({
  theme,
  onAgent,
  onTerminal,
  onBrowser,
  profiles,
  onProfile,
}: {
  theme: Theme;
  onAgent: () => void;
  onTerminal: () => void;
  onBrowser?: () => void;
  profiles: { id: string; name: string }[];
  onProfile: (id: string) => void;
}) {
  const p = palette(theme);
  return (
    <View
      testID="dialogs-menu"
      style={{
        width: 250,
        padding: 6,
        backgroundColor: p.menu,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: p.line,
      }}
    >
      <MenuLine
        theme={theme}
        label="Агент"
        icon="SquarePen"
        keys="⇧⌘A"
        onPress={onAgent}
      />
      <MenuLine
        theme={theme}
        label="Терминал"
        icon="SquareTerminal"
        keys="⇧⌘T"
        onPress={onTerminal}
      />
      {onBrowser && (
        <MenuLine
          theme={theme}
          label="Браузер"
          icon="Globe"
          keys="⇧⌘B"
          onPress={onBrowser}
        />
      )}
      {profiles.length > 0 && (
        <>
          <View
            style={{
              height: 1,
              backgroundColor: theme.colors.border,
              marginVertical: 6,
              marginHorizontal: -6,
            }}
          />
          <View
            style={{ paddingTop: 6, paddingBottom: 4, paddingHorizontal: 10 }}
          >
            <Label color={p.dim} size={12.5}>
              Профили терминала
            </Label>
          </View>
          {profiles.map((profile) => (
            <MenuLine
              key={profile.id}
              theme={theme}
              label={profile.name}
              provider={profile.id === "claude" ? "claude" : undefined}
              icon="SquareTerminal"
              onPress={() => onProfile(profile.id)}
            />
          ))}
        </>
      )}
    </View>
  );
}
export function WorkspaceForm({
  theme,
  name,
  onName,
  onCreate,
  onClose,
  pending = false,
  error,
  compact = false,
}: {
  theme: Theme;
  name: string;
  onName: (s: string) => void;
  onCreate: () => void;
  onClose: () => void;
  pending?: boolean;
  error?: string;
  compact?: boolean;
}) {
  const p = palette(theme);
  const [focused, setFocused] = useState(false);
  return (
    <View
      testID="dialogs-create"
      style={{
        width: compact ? undefined : 290,
        paddingTop: 8,
        paddingHorizontal: 10,
        paddingBottom: 10,
        backgroundColor: p.menu,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: p.line,
      }}
    >
      <View style={{ paddingTop: 6, paddingBottom: 4, paddingHorizontal: 10 }}>
        <Label color={p.dim} size={12.5}>
          Новая папка
        </Label>
      </View>
      <TextInput
        accessibilityLabel="Название"
        placeholder="Название, например CTG"
        placeholderTextColor={p.dim}
        value={name}
        onChangeText={onName}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={() => {
          if (name.trim() && !pending) onCreate();
        }}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === "Escape") onClose();
        }}
        style={{
          fontFamily: font,
          fontSize: 14,
          lineHeight: 18.9,
          color: p.fg,
          backgroundColor: p.input,
          borderColor: focused ? p.run : p.inputLine,
          borderWidth: 1,
          borderRadius: 8,
          paddingVertical: 8,
          paddingHorizontal: 10,
          marginTop: 2,
        }}
      />
      <View style={{ marginTop: 8, marginHorizontal: 2, marginBottom: 10 }}>
        <Text
          style={{
            fontFamily: font,
            color: p.dim,
            fontSize: 12,
            lineHeight: 16.2,
          }}
        >
          Каталог: AI OS (public), как у agmazin и ЭкоЭксперт
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Создать"
          disabled={!name.trim() || pending}
          onPress={onCreate}
          style={{
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderWidth: 1,
            borderColor: p.line,
            backgroundColor: p.button,
            borderRadius: 9,
            opacity: !name.trim() || pending ? 0.5 : 1,
          }}
        >
          <Label color={p.fg} size={13}>
            {pending ? "Создание..." : "Создать"}
          </Label>
        </Pressable>
      </View>
      {error && (
        <Label color={theme.colors.statusDanger} size={12}>
          {error}
        </Label>
      )}
    </View>
  );
}
