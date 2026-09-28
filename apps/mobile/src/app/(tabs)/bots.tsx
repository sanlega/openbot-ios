import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, Text } from "react-native";
import { DataCard } from "@/components/DataCard";
import { EmptyCard, Screen } from "@/components/Screen";
import { useConnection } from "@/connection/ConnectionProvider";
import { dataStyles } from "@/components/DataCard";

export default function BotsScreen() {
  const { client, state } = useConnection();
  const bots = useQuery({
    queryKey: ["openbot", "bots"],
    queryFn: () => client!.getBots(),
    enabled: !!client,
  });
  const threads = useQuery({
    queryKey: ["openbot", "threads"],
    queryFn: () => client!.getThreads(),
    enabled: !!client,
  });
  const visibleBots = bots.data?.bots.filter((bot) => !bot.hidden && !bot.archivedAt) ?? [];
  const turns = useQueries({
    queries: visibleBots.map((bot) => ({
      queryKey: ["openbot", "turns", bot.id],
      queryFn: () => client!.getBotTurns(bot.id),
      enabled: !!client,
    })),
  });
  const approvals = useQuery({
    queryKey: ["openbot", "approvals"],
    queryFn: () => client!.getApprovals("pending"),
    enabled: !!client,
  });
  const queryClient = useQueryClient();
  const stop = useMutation({
    mutationFn: (threadId: string) => client!.stopThread(threadId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["openbot"] }),
  });
  if (state.status !== "connected")
    return (
      <Screen>
        <EmptyCard
          title="Desktop unavailable"
          detail="Reconnect to OpenBot to see your Bot roster."
        />
      </Screen>
    );
  return (
    <Screen>
      {visibleBots.length ? (
        visibleBots.map((bot, index) => {
          const thread = threads.data?.threads.find((item) => item.botId === bot.id);
          const latest = turns[index]?.data?.turns.at(-1);
          const waiting = approvals.data?.approvals.some((item) => item.botId === bot.id);
          const status = waiting
            ? "WAITING"
            : latest?.status === "running" || latest?.status === "queued"
              ? "WORKING"
              : latest?.status === "failed"
                ? "FAILED"
                : latest?.status === "interrupted"
                  ? "STOPPED"
                  : "READY";
          const detail =
            latest?.status === "running" || latest?.status === "queued"
              ? `Task started ${new Date(latest.createdAt).toLocaleString()}`
              : bot.description;
          return (
            <DataCard key={bot.id} title={bot.label ?? bot.name} detail={detail} meta={status}>
              {(latest?.status === "running" || latest?.status === "queued") && thread ? (
                <Pressable
                  disabled={stop.isPending}
                  style={[dataStyles.button, dataStyles.secondary, { marginTop: 5 }]}
                  onPress={() => stop.mutate(thread.id)}
                >
                  <Text style={[dataStyles.buttonText, dataStyles.secondaryText]}>Stop task</Text>
                </Pressable>
              ) : null}
              {stop.isError ? (
                <Text style={{ color: "#FF7777", fontSize: 12 }}>{stop.error.message}</Text>
              ) : null}
            </DataCard>
          );
        })
      ) : (
        <EmptyCard
          title="No Bots yet"
          detail="Create a Bot on the OpenBot desktop to get started."
        />
      )}
    </Screen>
  );
}
