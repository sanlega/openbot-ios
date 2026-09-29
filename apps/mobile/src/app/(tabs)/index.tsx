import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ApprovalCard } from "@/components/ApprovalCard";
import { ConnectionChip, OfflineCard } from "@/components/ConnectionStatus";
import { InputCard } from "@/components/InputCard";
import { BotAvatar, Icon, Row, RowGroup, Screen, Section } from "@/components/ui";
import { useConnection } from "@/connection/ConnectionProvider";
import { STATUS_LABEL, plainText, relativeTime } from "@/lib/format";
import {
  useActivity,
  useApprovals,
  useBotStatuses,
  useInputs,
  useNamer,
  useRefresh,
  useRoster,
  useRoutines,
} from "@/lib/queries";
import { makeStyles, radius, space, type, useTheme } from "@/theme";

function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 19 ? "Good afternoon" : "Good evening";
}

export default function HomeScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { state } = useConnection();
  const refresh = useRefresh();
  const approvals = useApprovals();
  const inputs = useInputs();
  const activity = useActivity();
  const routines = useRoutines();
  const namer = useNamer();
  const { bots } = useRoster();
  const statuses = useBotStatuses(bots);
  const connected = state.status === "connected";

  const pendingApprovals = approvals.data?.approvals ?? [];
  const pendingInputs = inputs.data?.inputs ?? [];
  const waiting = pendingApprovals.length + pendingInputs.length;
  const working = bots.filter((bot) => statuses[bot.id] === "working").length;
  const recent = [...(activity.data?.messages ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((message) => message.author.type !== "user")
    .slice(0, 4);
  const activeRoutines = (routines.data?.routines ?? []).filter((routine) => routine.enabled);

  return (
    <Screen
      title={greeting()}
      subtitle={
        connected
          ? waiting
            ? `${waiting} ${waiting === 1 ? "thing needs" : "things need"} you`
            : working
              ? `${working} ${working === 1 ? "Bot is" : "Bots are"} working`
              : "Your team is all caught up"
          : undefined
      }
      trailing={<ConnectionChip />}
      {...(connected ? refresh : {})}
    >
      <OfflineCard />
      {connected ? (
        <>
          <View style={styles.stats}>
            <Stat
              icon="exclamationmark.bubble.fill"
              tint={waiting ? colors.amber : colors.subtle}
              value={waiting}
              label="Needs you"
              onPress={() => router.push("/(tabs)/inbox")}
            />
            <Stat
              icon="bolt.fill"
              tint={working ? colors.green : colors.subtle}
              value={working}
              label="Working"
              onPress={() => router.push("/(tabs)/chats")}
            />
            <Stat
              icon="clock.fill"
              tint={activeRoutines.length ? colors.accent : colors.subtle}
              value={activeRoutines.length}
              label="Routines"
              onPress={() => router.push("/routines")}
            />
          </View>

          {waiting ? (
            <Section title="Needs you">
              {pendingApprovals.slice(0, 2).map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} compact />
              ))}
              {pendingInputs.slice(0, Math.max(0, 2 - pendingApprovals.length)).map((input) => (
                <InputCard key={input.id} input={input} />
              ))}
              {waiting > 2 ? (
                <Row
                  title={`See all ${waiting} in Inbox`}
                  onPress={() => router.push("/(tabs)/inbox")}
                  chevron
                />
              ) : null}
            </Section>
          ) : null}

          {bots.length ? (
            <Section title="Your team">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.team}
                style={styles.teamScroll}
              >
                {bots.map((bot) => (
                  <Pressable
                    key={bot.id}
                    style={({ pressed }) => [styles.member, pressed && { opacity: 0.6 }]}
                    onPress={() =>
                      router.push({ pathname: "/chat/[botId]", params: { botId: bot.id } })
                    }
                  >
                    <BotAvatar bot={bot} size={56} status={statuses[bot.id]} />
                    <Text style={styles.memberName} numberOfLines={1}>
                      {bot.label ?? bot.name}
                    </Text>
                    <Text style={styles.memberStatus} numberOfLines={1}>
                      {STATUS_LABEL[statuses[bot.id] ?? "idle"]}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Section>
          ) : null}

          <Section title="Latest from your Bots">
            {recent.length ? (
              <RowGroup>
                {recent.map((message) => {
                  const bot = namer.get(message.author.id);
                  return (
                    <Row
                      key={message.id}
                      leading={bot ? <BotAvatar bot={bot} size={36} /> : undefined}
                      title={namer.name(message.author.id)}
                      subtitle={plainText(message.text)}
                      numberOfLines={2}
                      trailing={<Text style={styles.time}>{relativeTime(message.createdAt)}</Text>}
                      onPress={
                        bot
                          ? () =>
                              router.push({
                                pathname: "/chat/[botId]",
                                params: { botId: bot.id },
                              })
                          : undefined
                      }
                    />
                  );
                })}
              </RowGroup>
            ) : (
              <RowGroup>
                <Row
                  leading={<Icon name="sparkles" color={colors.accent} />}
                  title="Nothing new yet"
                  subtitle="Replies and results from your Bots will show up here."
                  numberOfLines={2}
                />
              </RowGroup>
            )}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}

function Stat({
  icon,
  tint,
  value,
  label,
  onPress,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  tint: string;
  value: number;
  label: string;
  onPress(): void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      style={({ pressed }) => [styles.stat, pressed && { opacity: 0.7 }]}
    >
      <Icon name={icon} size={18} color={tint} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  stats: { flexDirection: "row", gap: space[2] },
  stat: {
    flex: 1,
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: space[3],
    gap: 2,
  },
  statValue: {
    color: c.text,
    fontSize: type.title2,
    fontWeight: "700",
    marginTop: space[2],
    fontVariant: ["tabular-nums"],
  },
  statLabel: { color: c.muted, fontSize: type.footnote, fontWeight: "500" },
  teamScroll: { marginHorizontal: -space[4] },
  team: { paddingHorizontal: space[4], gap: space[4] },
  member: { width: 68, alignItems: "center", gap: 6 },
  memberName: { color: c.text, fontSize: type.footnote, fontWeight: "600", maxWidth: 72 },
  memberStatus: { color: c.subtle, fontSize: type.caption, marginTop: -3 },
  time: { color: c.subtle, fontSize: type.caption, fontVariant: ["tabular-nums"] },
}));
