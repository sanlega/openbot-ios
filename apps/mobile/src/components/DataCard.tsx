import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { colors } from "@/theme";

export function DataCard({
  title,
  detail,
  meta,
  onPress,
  children,
}: {
  title: string;
  detail?: string;
  meta?: string;
  onPress?: () => void;
  children?: ReactNode;
}) {
  const content = (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        {meta && <Text style={styles.meta}>{meta}</Text>}
      </View>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {children}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

export const dataStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 9, marginTop: 10 },
  button: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1 },
  buttonText: { color: "#071425", fontWeight: "700", fontSize: 13 },
  secondaryText: { color: colors.text },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 17,
    padding: 15,
    gap: 7,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { color: colors.text, fontWeight: "700", fontSize: 15, flex: 1 },
  meta: { color: colors.accent, fontSize: 11, fontWeight: "700" },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 19 },
});
