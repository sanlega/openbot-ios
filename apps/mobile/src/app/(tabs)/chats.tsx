import { router } from "expo-router";
import { Text, View } from "react-native";
import { OfflineCard } from "@/components/ConnectionStatus";
import { BotAvatar, EmptyState, Pill, Row, RowGroup, Screen } from "@/components/ui";
import { useConnection } from "@/connection/ConnectionProvider";
import { STATUS_LABEL, plainText, shortTime } from "@/lib/format";
import { useBotStatuses, useRefresh, useRoster, useThreads } from "@/lib/queries";
import { makeStyles, type } from "@/theme";

export default function ChatsScreen() {
  const styles = useStyles();
  const { state, live } = useConnection();
  const refresh = useRefresh();
  const { bots, isLoading } = useRoster();
  const threads = useThreads();
  const statuses = useBotStatuses(bots);
  const connected = state.status === "connected";

  const rows = bots
    .map((bot) => ({ bot, thread: threads.data?.threads.find((item) => item.botId === bot.id) }))
    .sort(
      (a, b) =>
        Number(b.bot.isChiefOfStaff) - Number(a.bot.isChiefOfStaff) ||
        (b.thread?.lastMessageAt ?? "").localeCompare(a.thread?.lastMessageAt ?? ""),
    );

  return (
    <Screen title="Chats" {...(connected ? refresh : {})}>
      <OfflineCard />
      {connected && rows.length ? (
        <RowGroup>
          {rows.map(({ bot, thread }) => {
            const status = statuses[bot.id] ?? "idle";
            const streaming = status === "working" ? live[bot.id] : undefined;
            return (
              <Row
                key={bot.id}
                leading={<BotAvatar bot={bot} size={46} status={status} />}
                title={bot.label ?? bot.name}
                subtitle={
                  streaming
                    ? `Typing… ${plainText(streaming).slice(-80)}`
                    : thread?.lastMessagePreview
                      ? plainText(thread.lastMessagePreview)
                      : bot.description || "Say hello"
                }
                numberOfLines={2}
                trailing={
                  <View style={styles.meta}>
                    {thread?.lastMessageAt ? (
                      <Text style={styles.time}>{shortTime(thread.lastMessageAt)}</Text>
                    ) : null}
                    {status === "needs-you" ? (
                      <Pill label={STATUS_LABEL[status]} tone="warning" />
                    ) : status === "working" ? (
                      <Pill label={STATUS_LABEL[status]} tone="success" />
                    ) : status === "failed" ? (
                      <Pill label={STATUS_LABEL[status]} tone="danger" />
                    ) : null}
                  </View>
                }
                onPress={() =>
                  router.push({ pathname: "/chat/[botId]", params: { botId: bot.id } })
                }
              />
            );
          })}
        </RowGroup>
      ) : connected && !isLoading ? (
        <EmptyState
          icon="person.2"
          title="No Bots yet"
          detail="Create your first Bot on the OpenBot desktop. It will show up here to chat with."
        />
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  meta: { alignItems: "flex-end", gap: 6, alignSelf: "flex-start", paddingTop: 2 },
  time: { color: c.subtle, fontSize: type.caption, fontVariant: ["tabular-nums"] },
}));
