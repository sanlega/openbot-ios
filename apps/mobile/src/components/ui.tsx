import type { Bot } from "@openbot/contracts";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { botHue, initials, type BotStatus } from "@/lib/format";
import { makeStyles, radius, space, type, useTheme, type Palette } from "@/theme";

/** A tab root: large title, optional trailing action, pull to refresh. */
export function Screen({
  title,
  subtitle,
  trailing,
  refreshing,
  onRefresh,
  children,
}: {
  title?: string;
  subtitle?: string;
  trailing?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={colors.subtle}
          />
        ) : undefined
      }
    >
      {title ? (
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.largeTitle} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {trailing}
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      {title ? (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Card({
  children,
  style,
  tone,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: "warning" | "danger" | "accent";
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toneBorder =
    tone === "warning"
      ? colors.amber
      : tone === "danger"
        ? colors.red
        : tone === "accent"
          ? colors.accent
          : undefined;
  return (
    <View style={[styles.card, toneBorder ? { borderColor: toneBorder } : null, style]}>
      {children}
    </View>
  );
}

/** Grouped list rows, iOS Settings style. */
export function RowGroup({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={styles.group}>
      {items.map((child, index) => (
        <View key={index}>
          {index > 0 ? <View style={styles.separator} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

export function Row({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  chevron,
  destructive,
  numberOfLines = 1,
}: {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  numberOfLines?: number;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const body = (
    <View style={styles.row}>
      {leading}
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, destructive && { color: colors.red }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={numberOfLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? <Icon name="chevron.right" size={13} color={colors.subtle} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => pressed && { backgroundColor: colors.surfaceRaised }}
    >
      {body}
    </Pressable>
  );
}

export type PillTone = "success" | "warning" | "danger" | "accent" | "muted";

export function Pill({ label, tone = "muted" }: { label: string; tone?: PillTone }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [fg, bg] = toneColors(colors, tone);
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function toneColors(colors: Palette, tone: PillTone): [string, string] {
  switch (tone) {
    case "success":
      return [colors.green, colors.greenSoft];
    case "warning":
      return [colors.amber, colors.amberSoft];
    case "danger":
      return [colors.red, colors.redSoft];
    case "accent":
      return [colors.accent, colors.accentSoft];
    default:
      return [colors.muted, colors.surfaceRaised];
  }
}

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  loading,
  compact,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: SFSymbol;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const fg =
    variant === "primary"
      ? colors.accentFg
      : variant === "danger"
        ? colors.red
        : variant === "ghost"
          ? colors.accent
          : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        variant === "primary" && { backgroundColor: colors.accent },
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && { backgroundColor: colors.redSoft },
        variant === "ghost" && { backgroundColor: "transparent" },
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.7, transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={compact ? 13 : 15} color={fg} weight="semibold" />
      ) : null}
      <Text style={[styles.buttonText, compact && styles.buttonTextCompact, { color: fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Icon({
  name,
  size = 17,
  color,
  weight = "regular",
}: {
  name: SFSymbol;
  size?: number;
  color: string;
  weight?: "regular" | "medium" | "semibold" | "bold";
}) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} />;
}

/** Same look as the desktop's `BotAvatar`: gradient disc, initials or crown, status dot. */
export function BotAvatar({
  bot,
  size = 40,
  status,
}: {
  bot: Pick<Bot, "id" | "name" | "avatar" | "isChiefOfStaff">;
  size?: number;
  status?: BotStatus;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const hue = botHue(bot);
  const gradient = bot.isChiefOfStaff
    ? "linear-gradient(135deg, #8b7bff, #5a48e6)"
    : `linear-gradient(135deg, hsl(${hue}, 70%, 62%), hsl(${hue + 18}, 64%, 48%))`;
  const emoji = bot.avatar && /\p{Extended_Pictographic}/u.test(bot.avatar) ? bot.avatar : null;
  const dotColor =
    status === "working" ? colors.accent : status === "needs-you" ? colors.amber : undefined;
  const dot = Math.max(10, Math.round(size * 0.28));
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden>
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            experimental_backgroundImage: gradient,
          },
        ]}
      >
        {emoji ? (
          <Text style={{ fontSize: Math.round(size * 0.5) }}>{emoji}</Text>
        ) : bot.isChiefOfStaff ? (
          <Icon name="crown" size={Math.round(size * 0.5)} color="#FFFFFF" weight="semibold" />
        ) : (
          <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.4) }]}>
            {initials(bot.name)}
          </Text>
        )}
      </View>
      {dotColor ? (
        <StatusDot
          size={dot}
          color={dotColor}
          border={colors.background}
          pulse={status === "working"}
        />
      ) : null}
    </View>
  );
}

function StatusDot({
  size,
  color,
  border,
  pulse,
}: {
  size: number;
  color: string;
  border: string;
  pulse: boolean;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, opacity]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        right: -1,
        bottom: -1,
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: border,
        backgroundColor: color,
        opacity,
      }}
    />
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: SFSymbol;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={22} color={colors.muted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
      {action}
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  const styles = useStyles();
  if (!error) return null;
  return (
    <Text style={styles.error}>
      {error instanceof Error ? error.message : "Something went wrong."}
    </Text>
  );
}

export function Mono({ children }: { children: string }) {
  const styles = useStyles();
  return (
    <Text style={styles.mono} numberOfLines={4} selectable>
      {children}
    </Text>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background },
  screenContent: { paddingHorizontal: space[4], paddingBottom: space[8], gap: space[5] },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[3],
    paddingTop: space[2],
  },
  largeTitle: { color: c.text, fontSize: type.largeTitle, fontWeight: "700", letterSpacing: 0.2 },
  subtitle: { color: c.muted, fontSize: type.subhead, marginTop: 2 },
  section: { gap: space[2] },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[1],
  },
  sectionTitle: {
    color: c.muted,
    fontSize: type.footnote,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space[4],
    gap: space[3],
  },
  group: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
  },
  separator: { height: 1, backgroundColor: c.border, marginLeft: space[4] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: 52,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { color: c.text, fontSize: type.body, fontWeight: "600" },
  rowSubtitle: { color: c.muted, fontSize: type.subhead, lineHeight: 18 },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: type.caption, fontWeight: "700", letterSpacing: 0.2 },
  button: {
    minHeight: 46,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
  },
  buttonCompact: { minHeight: 34, borderRadius: radius.sm, paddingHorizontal: space[3] },
  buttonSecondary: { backgroundColor: c.surfaceRaised, borderWidth: 1, borderColor: c.border },
  buttonText: { fontSize: type.body, fontWeight: "600" },
  buttonTextCompact: { fontSize: type.subhead },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFFFFF", fontWeight: "600", letterSpacing: 0.2 },
  empty: {
    alignItems: "center",
    paddingVertical: space[8],
    paddingHorizontal: space[6],
    gap: space[2],
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space[1],
  },
  emptyTitle: { color: c.text, fontSize: type.headline, fontWeight: "600", textAlign: "center" },
  emptyDetail: { color: c.muted, fontSize: type.subhead, lineHeight: 19, textAlign: "center" },
  error: { color: c.red, fontSize: type.footnote, lineHeight: 17 },
  mono: {
    fontFamily: "Menlo",
    fontSize: type.footnote,
    color: c.text,
    backgroundColor: c.surfaceRaised,
    borderRadius: radius.sm,
    padding: space[3],
    overflow: "hidden",
  },
}));
