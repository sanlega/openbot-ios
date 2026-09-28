import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { EmptyCard } from "@/components/Screen";
import { useConnection } from "@/connection/ConnectionProvider";
import { colors } from "@/theme";

export default function ThreadScreen() {
  const { id, bot } = useLocalSearchParams<{ id: string; bot?: string }>();
  const { client, state } = useConnection();
  const queries = useQueryClient();
  const [text, setText] = useState("");
  const messages = useQuery({
    queryKey: ["openbot", "messages", id],
    queryFn: () => client!.getMessages(id),
    enabled: !!client && !!id,
  });
  const thread = useQuery({
    queryKey: ["openbot", "threads"],
    queryFn: () => client!.getThreads(),
    enabled: !!client,
  });
  const send = useMutation({
    mutationFn: async (value: string) => {
      const parent = thread.data?.threads.find((item) => item.id === id);
      if (!parent) throw new Error("Conversation unavailable.");
      await client!.sendMessage(parent.botId, id, value);
    },
    onSuccess: async () => {
      setText("");
      await queries.invalidateQueries({ queryKey: ["openbot", "messages", id] });
    },
  });
  if (state.status !== "connected")
    return (
      <View style={styles.empty}>
        <EmptyCard title="Desktop disconnected" detail="Reconnect to continue this conversation." />
      </View>
    );
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.subtitle}>
          {bot ?? "OpenBot"} · conversation history from your desktop
        </Text>
        {messages.data?.messages.map((message) => (
          <View
            key={message.id}
            style={[styles.bubble, message.author.type === "user" ? styles.mine : styles.theirs]}
          >
            <Text style={styles.author}>
              {message.author.type === "user" ? "You" : (bot ?? message.author.id ?? "Bot")}
            </Text>
            <Text style={styles.message}>{message.text}</Text>
            <Text style={styles.time}>
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          </View>
        ))}
        {messages.isLoading ? <ActivityIndicator color={colors.accent} /> : null}
      </ScrollView>
      {send.error ? <Text style={styles.error}>{send.error.message}</Text> : null}
      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message your Bot…"
          placeholderTextColor={colors.subtle}
          multiline
          style={styles.input}
        />
        <Pressable
          disabled={!text.trim() || send.isPending}
          onPress={() => send.mutate(text.trim())}
          style={[styles.send, (!text.trim() || send.isPending) && styles.disabled]}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  empty: { flex: 1, padding: 20, backgroundColor: colors.background },
  list: { padding: 16, gap: 12, flexGrow: 1 },
  subtitle: { color: colors.muted, fontSize: 12, marginBottom: 8 },
  bubble: { maxWidth: "88%", padding: 13, borderRadius: 16, gap: 5 },
  mine: { alignSelf: "flex-end", backgroundColor: "#1D3553" },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  author: { color: colors.accent, fontSize: 11, fontWeight: "700" },
  message: { color: colors.text, fontSize: 14, lineHeight: 21 },
  time: { color: colors.subtle, fontSize: 10, alignSelf: "flex-end" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
  },
  send: {
    height: 44,
    paddingHorizontal: 16,
    backgroundColor: colors.accent,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.4 },
  sendText: { color: "#071425", fontWeight: "700" },
  error: { color: colors.red, paddingHorizontal: 14, fontSize: 12 },
});
