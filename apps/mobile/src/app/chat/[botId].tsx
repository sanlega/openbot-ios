import type { Message } from "@openbot/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApprovalCard } from "@/components/ApprovalCard";
import { InputCard } from "@/components/InputCard";
import { Markdown } from "@/components/Markdown";
import { BotAvatar, EmptyState, ErrorText, Icon } from "@/components/ui";
import { useConnection } from "@/connection/ConnectionProvider";
import { setVisibleChat } from "@/connection/push";
import { STATUS_LABEL, clockTime, dayLabel, sameDay } from "@/lib/format";
import {
  useApprovals,
  useBotStatuses,
  useBots,
  useInputs,
  useMessages,
  useNamer,
  useThreads,
} from "@/lib/queries";
import { makeStyles, radius, space, type, useTheme } from "@/theme";

type Item =
  | { kind: "message"; message: Message; showDay: boolean }
  | { kind: "pending"; id: string; text: string }
  | { kind: "live"; text: string };

export default function ChatScreen() {
  const { botId } = useLocalSearchParams<{ botId: string }>();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { client, state, live } = useConnection();
  const queryClient = useQueryClient();
  const bots = useBots();
  const bot = bots.data?.bots.find((item) => item.id === botId);
  const threads = useThreads();
  const thread = threads.data?.threads.find((item) => item.botId === botId);
  const messages = useMessages(thread?.id);
  const approvals = useApprovals();
  const inputs = useInputs();
  const namer = useNamer();
  const statuses = useBotStatuses(bot ? [bot] : []);
  const status = bot ? statuses[bot.id] : undefined;
  const [text, setText] = useState("");
  useFocusEffect(
    useCallback(() => {
      setVisibleChat(botId);
      return () => setVisibleChat(undefined);
    }, [botId]),
  );
  const [pending, setPending] = useState<{ id: string; text: string }[]>([]);
  const connected = state.status === "connected";

  const send = useMutation({
    mutationFn: (value: string) => client!.sendMessage(botId, thread?.id, value),
    onMutate: (value) => {
      const id = `local_${Date.now()}`;
      setPending((items) => [...items, { id, text: value }]);
      setText("");
      return { id, value };
    },
    onError: (_error, _value, context) => {
      if (!context) return;
      setPending((items) => items.filter((item) => item.id !== context.id));
      setText(context.value);
    },
    onSettled: async (_data, _error, _value, context) => {
      await queryClient.invalidateQueries({ queryKey: ["openbot", "threads"] });
      await queryClient.invalidateQueries({ queryKey: ["openbot", "messages"] });
      if (context) setPending((items) => items.filter((item) => item.id !== context.id));
    },
  });
  const stop = useMutation({
    mutationFn: () => client!.stopThread(thread!.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["openbot"] }),
  });

  const botApprovals = (approvals.data?.approvals ?? []).filter((item) => item.botId === botId);
  const botInputs = (inputs.data?.inputs ?? []).filter((item) => item.botId === botId);
  const working = status === "working";
  // Deltas can arrive after the final message (event order is not guaranteed),
  // so streamed text only shows while the turn is still running.
  const streaming = working ? live[botId] : undefined;

  // Newest first: the list is inverted so it opens at the latest message.
  const items = useMemo<Item[]>(() => {
    // Oldest first regardless of the order the desktop returns.
    const list = (messages.data?.messages ?? [])
      .filter((message) => message.delivery !== "held")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const rows: Item[] = list.map((message, index) => ({
      kind: "message",
      message,
      showDay: index === 0 || !sameDay(list[index - 1]!.createdAt, message.createdAt),
    }));
    for (const item of pending) rows.push({ kind: "pending", ...item });
    if (working) rows.push({ kind: "live", text: streaming ?? "" });
    return rows.reverse();
  }, [messages.data, pending, streaming, working]);

  const title = bot ? (bot.label ?? bot.name) : "Chat";
  const canSend = connected && !!text.trim() && !send.isPending;

  return (
    <>
      <Stack.Screen
        options={{
          headerTransparent: false,
          headerStyle: { backgroundColor: colors.background },
          headerTitle: () => (
            <View style={styles.headerTitle}>
              {bot ? <BotAvatar bot={bot} size={30} status={status} /> : null}
              <View>
                <Text style={styles.headerName} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={styles.headerStatus}>
                  {!connected
                    ? "Offline"
                    : streaming
                      ? "Typing…"
                      : status
                        ? STATUS_LABEL[status]
                        : ""}
                </Text>
              </View>
            </View>
          ),
          headerRight: () =>
            working && thread ? (
              <Pressable
                onPress={() => stop.mutate()}
                disabled={stop.isPending}
                accessibilityLabel="Stop the current task"
                hitSlop={10}
                style={styles.stop}
              >
                <Icon name="stop.fill" size={12} color={colors.red} />
                <Text style={styles.stopText}>Stop</Text>
              </Pressable>
            ) : null,
        }}
      />
      <KeyboardAvoidingView
        style={styles.root}
        behavior="padding"
        keyboardVerticalOffset={insets.top + 44}
      >
        <FlatList
          inverted
          data={items}
          keyExtractor={(item) =>
            item.kind === "message" ? item.message.id : item.kind === "pending" ? item.id : "live"
          }
          contentContainerStyle={styles.list}
          keyboardDismissMode="interactive"
          ListHeaderComponent={
            botApprovals.length || botInputs.length ? (
              <View style={styles.attention}>
                {botApprovals.map((approval) => (
                  <ApprovalCard key={approval.id} approval={approval} compact />
                ))}
                {botInputs.map((input) => (
                  <InputCard key={input.id} input={input} />
                ))}
              </View>
            ) : null
          }
          ListEmptyComponent={
            messages.isLoading ? (
              <ActivityIndicator color={colors.subtle} style={{ marginTop: 40 }} />
            ) : bot ? (
              <View style={styles.flip}>
                <EmptyState
                  icon="bubble.left.and.text.bubble.right"
                  title={`Start a conversation with ${title}`}
                  detail={bot.description || "Ask for anything. Replies arrive here live."}
                />
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            if (item.kind === "live") {
              return (
                <View style={[styles.bubble, styles.theirs]}>
                  {item.text ? (
                    <Markdown text={item.text} color={colors.text} />
                  ) : (
                    <View style={styles.typing}>
                      <ActivityIndicator size="small" color={colors.subtle} />
                      <Text style={styles.typingText}>Working on it…</Text>
                    </View>
                  )}
                </View>
              );
            }
            if (item.kind === "pending") {
              return (
                <View style={[styles.bubble, styles.mine, { opacity: 0.6 }]}>
                  <Text style={[styles.mineText]}>{item.text}</Text>
                  <Text style={[styles.time, styles.mineTime]}>Sending…</Text>
                </View>
              );
            }
            const { message, showDay } = item;
            const mine = message.author.type === "user";
            const system = message.author.type === "system" || message.author.type === "routine";
            return (
              <View>
                {showDay ? <Text style={styles.day}>{dayLabel(message.createdAt)}</Text> : null}
                {system ? (
                  <Text style={styles.system}>{namer.humanize(message.text)}</Text>
                ) : (
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                    {mine ? (
                      <Markdown text={message.text} color={colors.userBubbleFg} />
                    ) : (
                      <Markdown text={namer.humanize(message.text)} color={colors.text} />
                    )}
                    <Text style={[styles.time, mine && styles.mineTime]}>
                      {clockTime(message.createdAt)}
                    </Text>
                  </View>
                )}
              </View>
            );
          }}
        />
        <ErrorText error={send.error ?? stop.error} />
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={connected ? `Message ${title}` : "Reconnecting to your desktop…"}
            placeholderTextColor={colors.subtle}
            editable={connected}
            multiline
            style={styles.input}
          />
          <Pressable
            onPress={() => send.mutate(text.trim())}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            style={({ pressed }) => [
              styles.send,
              !canSend && { backgroundColor: colors.surfaceHigh },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Icon
              name="arrow.up"
              size={17}
              color={canSend ? colors.accentFg : colors.subtle}
              weight="bold"
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  list: { paddingHorizontal: space[3], paddingVertical: space[3], gap: 6, flexGrow: 1 },
  flip: { transform: [{ scaleY: -1 }], flex: 1, justifyContent: "center" },
  attention: { gap: space[3], paddingTop: space[3] },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: space[2] },
  headerName: { color: c.text, fontSize: type.body, fontWeight: "700", maxWidth: 200 },
  headerStatus: { color: c.muted, fontSize: type.caption },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: c.redSoft,
  },
  stopText: { color: c.red, fontSize: type.footnote, fontWeight: "700" },
  day: {
    alignSelf: "center",
    color: c.subtle,
    fontSize: type.caption,
    fontWeight: "600",
    marginVertical: space[3],
  },
  system: {
    alignSelf: "center",
    textAlign: "center",
    color: c.muted,
    fontSize: type.footnote,
    maxWidth: "85%",
    marginVertical: space[2],
  },
  bubble: {
    maxWidth: "84%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg + 2,
    gap: 4,
  },
  mine: { alignSelf: "flex-end", backgroundColor: c.userBubble, borderBottomRightRadius: 6 },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderBottomLeftRadius: 6,
  },
  mineText: { color: c.userBubbleFg, fontSize: type.body, lineHeight: 21 },
  time: {
    color: c.subtle,
    fontSize: 10,
    alignSelf: "flex-end",
    fontVariant: ["tabular-nums"],
  },
  mineTime: { color: c.userBubbleFg, opacity: 0.65 },
  typing: { flexDirection: "row", alignItems: "center", gap: space[2] },
  typingText: { color: c.muted, fontSize: type.subhead },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[2],
    paddingHorizontal: space[3],
    paddingTop: space[2],
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.background,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    color: c.text,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 20,
    paddingHorizontal: space[4],
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: type.body,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.accent,
    alignItems: "center",
    justifyContent: "center",
  },
}));
