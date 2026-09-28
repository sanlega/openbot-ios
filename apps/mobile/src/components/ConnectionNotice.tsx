import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useConnection } from "@/connection/ConnectionProvider";
import { colors } from "@/theme";

const labels = {
  connected: "Desktop connected",
  connecting: "Connecting to desktop…",
  reconnecting: "Reconnecting…",
  suspended: "Connection paused while app is in background",
  revoked: "This phone was revoked",
  disconnected: "Desktop not connected",
} as const;

export function ConnectionNotice() {
  const { state } = useConnection();
  const online = state.status === "connected";
  return (
    <View style={[styles.card, online && styles.online]}>
      <View style={[styles.dot, online && styles.green]} />
      <Text style={styles.label}>{labels[state.status]}</Text>
      {!online && (
        <Link href="/scan" asChild>
          <Pressable>
            <Text style={styles.action}>Pair</Text>
          </Pressable>
        </Link>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  online: { borderColor: "#28543F" },
  dot: { width: 8, height: 8, borderRadius: 9, backgroundColor: colors.red },
  green: { backgroundColor: colors.green },
  label: { flex: 1, color: colors.text, fontWeight: "600", fontSize: 13 },
  action: { color: colors.accent, fontWeight: "700", padding: 4 },
});
