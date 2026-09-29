import { router } from "expo-router";
import { Text } from "react-native";
import { ApprovalCard } from "@/components/ApprovalCard";
import { OfflineCard } from "@/components/ConnectionStatus";
import { InputCard } from "@/components/InputCard";
import { BotAvatar, EmptyState, Row, RowGroup, Screen, Section } from "@/components/ui";
import { useConnection } from "@/connection/ConnectionProvider";
import { plainText, relativeTime } from "@/lib/format";
import { useActivity, useApprovals, useInputs, useNamer, useRefresh } from "@/lib/queries";
import { makeStyles, type } from "@/theme";

export default function InboxScreen() {
  const styles = useStyles();
  const { state } = useConnection();
  const refresh = useRefresh();
  const approvals = useApprovals();
  const inputs = useInputs();
  const activity = useActivity();
  const namer = useNamer();
  const connected = state.status === "connected";
  const pendingApprovals = approvals.data?.approvals ?? [];
  const pendingInputs = inputs.data?.inputs ?? [];
  const messages = [...(activity.data?.messages ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 25);

  return (
    <Screen title="Inbox" {...(connected ? refresh : {})}>
      <OfflineCard />
      {connected ? (
        <>
          {pendingApprovals.length ? (
            <Section title={`Approvals · ${pendingApprovals.length}`}>
              {pendingApprovals.map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} />
              ))}
            </Section>
          ) : null}
          {pendingInputs.length ? (
            <Section title={`Questions · ${pendingInputs.length}`}>
              {pendingInputs.map((input) => (
                <InputCard key={input.id} input={input} />
              ))}
            </Section>
          ) : null}
          {!pendingApprovals.length && !pendingInputs.length ? (
            <EmptyState
              icon="checkmark.seal"
              title="You're all caught up"
              detail="When a Bot needs your OK or asks you something, it lands here."
            />
          ) : null}
          {messages.length ? (
            <Section title="Recent activity">
              <RowGroup>
                {messages.map((message) => {
                  const mine = message.author.type === "user";
                  const bot = mine ? undefined : namer.get(message.author.id);
                  const target = bot?.id ?? (mine ? undefined : message.author.id);
                  return (
                    <Row
                      key={message.id}
                      leading={bot ? <BotAvatar bot={bot} size={32} /> : undefined}
                      title={
                        mine
                          ? "You"
                          : message.author.type === "routine"
                            ? "Routine"
                            : namer.name(message.author.id)
                      }
                      subtitle={plainText(namer.humanize(message.text))}
                      numberOfLines={2}
                      trailing={<Text style={styles.time}>{relativeTime(message.createdAt)}</Text>}
                      onPress={
                        target && bot
                          ? () =>
                              router.push({
                                pathname: "/chat/[botId]",
                                params: { botId: target },
                              })
                          : undefined
                      }
                    />
                  );
                })}
              </RowGroup>
            </Section>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  time: {
    color: c.subtle,
    fontSize: type.caption,
    fontVariant: ["tabular-nums"],
    alignSelf: "flex-start",
    paddingTop: 2,
  },
}));
