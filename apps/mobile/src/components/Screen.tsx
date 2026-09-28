import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {children}
      <View style={styles.footer}>
        <View style={styles.footerDot} />
        <Text style={styles.footerText}>Your data stays on your OpenBot desktop</Text>
      </View>
    </ScrollView>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function EmptyCard({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 34, gap: 16 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: 8 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    gap: 7,
  },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  emptyDetail: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  footer: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8 },
  footerDot: { width: 6, height: 6, backgroundColor: colors.green, borderRadius: 99 },
  footerText: { color: colors.subtle, fontSize: 11 },
});
