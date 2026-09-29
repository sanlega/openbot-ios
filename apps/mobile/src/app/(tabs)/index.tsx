import { Link } from "expo-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { ConnectionNotice } from "@/components/ConnectionNotice";
import { DataCard } from "@/components/DataCard";
import { EmptyCard, Screen, SectionTitle } from "@/components/Screen";
import { useConnection } from "@/connection/ConnectionProvider";
import { colors } from "@/theme";

export default function HomeScreen() {
  const { client, state } = useConnection();
  const approvals = useQuery({
    queryKey: ["openbot", "approvals"],
    queryFn: () => client!.getApprovals("pending"),
    enabled: !!client,
  });
  const bots = useQuery({
    queryKey: ["openbot", "bots"],
    queryFn: () => client!.getBots(),
    enabled: !!client,
  });
  const activity = useQuery({
    queryKey: ["openbot", "activity"],
    queryFn: () => client!.getActivity(),
    enabled: !!client,
  });
  const threads = useQuery({
    queryKey: ["openbot", "threads"],
    queryFn: () => client!.getThreads(),
    enabled: !!client,
  });
  const visibleBots =
    bots.data?.bots.filter((bot) => !bot.hidden && !bot.archivedAt).slice(0, 4) ?? [];
  const turns = useQueries({
    queries: visibleBots.map((bot) => ({
      queryKey: ["openbot", "turns", bot.id],
      queryFn: () => client!.getBotTurns(bot.id),
      enabled: !!client,
    })),
  });
  return (
    <Screen>
      <ConnectionNotice />
      {state.status === "connected" ? (
        <>
          <SectionTitle>
            Needs your attention{" "}
            {approvals.data?.approvals.length ? `· ${approvals.data.approvals.length}` : ""}
          </SectionTitle>
          {approvals.data?.approvals.length ? (
            approvals.data.approvals.map((approval) => (
              <DataCard
                key={approval.id}
                title={approval.summary}
                detail={approval.detail}
                meta="APPROVAL"
              >
                <Text style={styles.caption}>Review and resolve in Activity.</Text>
              </DataCard>
            ))
          ) : (
            <EmptyCard
              title="No pending approvals"
              detail="Approval requests from your Bots will appear here."
            />
          )}
          <SectionTitle>Bots</SectionTitle>
          {visibleBots.map((bot, index) => {
            const latest = turns[index]?.data?.turns.at(-1);
            const waiting = approvals.data?.approvals.some((item) => item.botId === bot.id);
            const status = waiting
              ? "WAITING"
              : latest?.status === "running" || latest?.status === "queued"
                ? "WORKING"
                : latest?.status === "failed"
                  ? "FAILED"
                  : "READY";
            return (
              <DataCard
                key={bot.id}
                title={bot.name}
                detail={
                  latest?.status === "running" || latest?.status === "queued"
                    ? `Working since ${new Date(latest.createdAt).toLocaleTimeString()}`
                    : bot.description
                }
                meta={status}
              />
            );
          })}
          {bots.data && bots.data.bots.length === 0 ? (
            <EmptyCard
              title="No Bots yet"
              detail="Create and configure Bots on your OpenBot desktop."
            />
          ) : null}
          <SectionTitle>Recent activity</SectionTitle>
          {activity.data?.messages.slice(0, 3).map((message) => (
            <DataCard
              key={message.id}
              title={message.author.type === "user" ? "You" : (message.author.id ?? "OpenBot")}
              detail={message.text}
              meta={new Date(message.createdAt).toLocaleDateString()}
            />
          ))}
          {activity.data?.messages.length === 0 ? (
            <EmptyCard
              title="Nothing new"
              detail="New messages and work updates will show up here."
            />
          ) : null}
          <Link href="/(tabs)/threads" asChild>
            <Pressable>
              <Text style={styles.link}>
                {threads.data?.threads.length ?? 0} conversations · View all
              </Text>
            </Pressable>
          </Link>
        </>
      ) : (
        <View style={styles.offline}>
          <Text style={styles.eyebrow}>GET STARTED</Text>
          <Text style={styles.offlineTitle}>Pair your OpenBot desktop</Text>
          <Text style={styles.caption}>
            Scan its pairing QR code to monitor Bots, follow conversations, and handle approvals
            from your phone.
          </Text>
          <Link href="/scan" asChild>
            <Pressable style={styles.pairButton}>
              <Text style={styles.pairButtonLabel}>Scan pairing code</Text>
            </Pressable>
          </Link>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  offline: {
    gap: 12,
    padding: 22,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  offlineTitle: { color: colors.text, fontSize: 23, fontWeight: "700" },
  caption: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  pairButton: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  pairButtonLabel: { color: colors.background, fontSize: 15, fontWeight: "700" },
  link: { color: colors.accent, fontWeight: "700", paddingVertical: 7 },
});
