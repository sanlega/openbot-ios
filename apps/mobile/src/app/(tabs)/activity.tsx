import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, Text } from "react-native";
import { ConnectionNotice } from "@/components/ConnectionNotice";
import { DataCard, dataStyles } from "@/components/DataCard";
import { EmptyCard, Screen, SectionTitle } from "@/components/Screen";
import { useConnection } from "@/connection/ConnectionProvider";

export default function ActivityScreen() {
  const { client, state, events } = useConnection();
  const queryClient = useQueryClient();
  const approvals = useQuery({
    queryKey: ["openbot", "approvals"],
    queryFn: () => client!.getApprovals("pending"),
    enabled: !!client,
  });
  const activity = useQuery({
    queryKey: ["openbot", "activity"],
    queryFn: () => client!.getActivity(),
    enabled: !!client,
  });
  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "allow" | "deny" }) =>
      client!.resolveApproval(id, decision),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["openbot"] }),
  });
  return (
    <Screen>
      <ConnectionNotice />
      <SectionTitle>Pending approvals</SectionTitle>
      {state.status !== "connected" ? (
        <EmptyCard title="Desktop unavailable" detail="Reconnect to review approval requests." />
      ) : approvals.data?.approvals.length ? (
        approvals.data.approvals.map((item) => (
          <DataCard
            key={item.id}
            title={item.summary}
            detail={`${item.detail}\n\nExpires ${new Date(item.expiresAt).toLocaleString()}`}
            meta={item.kind.replaceAll("_", " ").toUpperCase()}
          >
            <ViewButtons
              disabled={resolve.isPending}
              onChoice={(decision) => resolve.mutate({ id: item.id, decision })}
            />
            {resolve.isError ? <Text>{resolve.error.message}</Text> : null}
          </DataCard>
        ))
      ) : (
        <EmptyCard
          title="No pending approvals"
          detail="If a Bot needs your decision, it will appear here."
        />
      )}
      <SectionTitle>Recent activity</SectionTitle>
      {activity.data?.messages.map((message) => (
        <DataCard
          key={message.id}
          title={message.author.type === "user" ? "You" : (message.author.id ?? "OpenBot")}
          detail={message.text}
          meta={new Date(message.createdAt).toLocaleString()}
        />
      ))}
      <SectionTitle>Live agent events</SectionTitle>
      {events.map((event) => (
        <DataCard
          key={event.id}
          title={event.type.replaceAll(".", " · ")}
          detail={
            [event.botId, event.threadId].filter(Boolean).join(" · ") || "OpenBot system event"
          }
          meta={new Date(event.ts).toLocaleTimeString()}
        />
      ))}
      {activity.data?.messages.length === 0 ? (
        <EmptyCard title="No recent activity" detail="Updates from your Bots will appear here." />
      ) : null}
    </Screen>
  );
}

function ViewButtons({
  disabled,
  onChoice,
}: {
  disabled: boolean;
  onChoice(decision: "allow" | "deny"): void;
}) {
  return (
    <View style={dataStyles.row}>
      <Pressable
        disabled={disabled}
        style={[dataStyles.button, dataStyles.secondary]}
        onPress={() => onChoice("deny")}
      >
        <Text style={[dataStyles.buttonText, dataStyles.secondaryText]}>Deny</Text>
      </Pressable>
      <Pressable disabled={disabled} style={dataStyles.button} onPress={() => onChoice("allow")}>
        <Text style={dataStyles.buttonText}>Approve</Text>
      </Pressable>
    </View>
  );
}

import { View } from "react-native";
