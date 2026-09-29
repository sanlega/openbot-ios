import { router } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { useConnection } from "@/connection/ConnectionProvider";
import { makeStyles, radius, space, type, useTheme } from "@/theme";
import { Button, Card, Icon } from "./ui";

const LABELS = {
  connected: "Connected",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  suspended: "Paused",
  revoked: "Access removed",
  disconnected: "Not paired",
} as const;

/** Small status chip for screen headers. */
export function ConnectionChip() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { state } = useConnection();
  const busy = state.status === "connecting" || state.status === "reconnecting";
  const color =
    state.status === "connected"
      ? colors.green
      : busy || state.status === "suspended"
        ? colors.amber
        : colors.red;
  return (
    <View style={styles.chip} accessibilityLabel={`Desktop ${LABELS[state.status]}`}>
      {busy ? (
        <ActivityIndicator size="small" color={color} style={{ transform: [{ scale: 0.7 }] }} />
      ) : (
        <View style={[styles.dot, { backgroundColor: color }]} />
      )}
      <Text style={styles.chipText}>{LABELS[state.status]}</Text>
    </View>
  );
}

/** Shown in place of content when the desktop is not reachable. */
export function OfflineCard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { state } = useConnection();
  if (state.status === "connected") return null;
  const paired = state.status !== "disconnected" && state.status !== "revoked";
  return (
    <Card>
      <View style={styles.offlineHead}>
        <View style={styles.offlineIcon}>
          <Icon
            name={paired ? "wifi.exclamationmark" : "qrcode.viewfinder"}
            size={22}
            color={colors.accent}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.offlineTitle}>
            {paired
              ? "Reaching your desktop…"
              : state.status === "revoked"
                ? "This phone was removed"
                : "Pair with your desktop"}
          </Text>
          <Text style={styles.offlineBody}>
            {paired
              ? "Keep OpenBot open on your desktop and stay on the same network."
              : "Scan the QR code in OpenBot → Settings → Devices to follow your Bots from here."}
          </Text>
        </View>
      </View>
      {!paired ? (
        <Button label="Pair a desktop" icon="qrcode" onPress={() => router.push("/scan")} />
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { color: c.muted, fontSize: type.footnote, fontWeight: "600" },
  offlineHead: { flexDirection: "row", gap: space[3], alignItems: "center" },
  offlineIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  offlineTitle: { color: c.text, fontSize: type.headline, fontWeight: "700" },
  offlineBody: { color: c.muted, fontSize: type.subhead, lineHeight: 18 },
}));
