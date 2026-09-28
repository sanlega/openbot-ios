import { Link } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DataCard } from "@/components/DataCard";
import { Pressable } from "react-native";
import { EmptyCard, Screen } from "@/components/Screen";
import { useConnection } from "@/connection/ConnectionProvider";

export default function ThreadsScreen() {
  const { client, state } = useConnection();
  const threads = useQuery({
    queryKey: ["openbot", "threads"],
    queryFn: () => client!.getThreads(),
    enabled: !!client,
  });
  const bots = useQuery({
    queryKey: ["openbot", "bots"],
    queryFn: () => client!.getBots(),
    enabled: !!client,
  });
  if (state.status !== "connected")
    return (
      <Screen>
        <EmptyCard
          title="Pair your desktop to see conversations"
          detail="Conversation history stays on your OpenBot desktop."
        />
      </Screen>
    );
  const list = [...(threads.data?.threads ?? [])].reverse();
  return (
    <Screen>
      {list.length ? (
        list.map((thread) => {
          const bot = bots.data?.bots.find((item) => item.id === thread.botId);
          return (
            <Link
              key={thread.id}
              href={{
                pathname: "/thread/[id]",
                params: { id: thread.id, bot: bot?.name ?? "Bot" },
              }}
              asChild
            >
              <Pressable>
                <DataCard
                  title={thread.title ?? bot?.label ?? bot?.name ?? "OpenBot conversation"}
                  detail={
                    thread.lastMessagePreview ??
                    `Started ${new Date(thread.createdAt).toLocaleString()}`
                  }
                  meta={
                    thread.lastMessageAt
                      ? new Date(thread.lastMessageAt).toLocaleDateString()
                      : "OPEN"
                  }
                />
              </Pressable>
            </Link>
          );
        })
      ) : (
        <EmptyCard
          title="No conversations yet"
          detail="Start a conversation with a Bot on desktop. It will appear here automatically."
        />
      )}
    </Screen>
  );
}
