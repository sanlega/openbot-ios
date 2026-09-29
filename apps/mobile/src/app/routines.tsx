import type { Routine } from "@openbot/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { OfflineCard } from "@/components/ConnectionStatus";
import { BotAvatar, Button, Card, EmptyState, ErrorText, Pill, Screen } from "@/components/ui";
import { useConnection } from "@/connection/ConnectionProvider";
import { relativeTime } from "@/lib/format";
import { useNamer, useRefresh, useRoutines } from "@/lib/queries";
import { describeTrigger } from "@/lib/routines";
import { makeStyles, space, type } from "@/theme";

export default function RoutinesScreen() {
  const { state } = useConnection();
  const refresh = useRefresh();
  const routines = useRoutines();
  const connected = state.status === "connected";
  const list = routines.data?.routines ?? [];
  return (
    <Screen {...(connected ? refresh : {})}>
      <OfflineCard />
      {connected && list.length
        ? list.map((routine) => <RoutineCard key={routine.id} routine={routine} />)
        : null}
      {connected && routines.data && !list.length ? (
        <EmptyState
          icon="clock.arrow.circlepath"
          title="No routines yet"
          detail="Ask a Bot to do something on a schedule, or create a routine on your desktop."
        />
      ) : null}
    </Screen>
  );
}

function RoutineCard({ routine }: { routine: Routine }) {
  const styles = useStyles();
  const { client } = useConnection();
  const queryClient = useQueryClient();
  const namer = useNamer();
  const bot = namer.get(routine.botId);
  const [notice, setNotice] = useState<string>();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["openbot", "routines"] });
  const run = useMutation({
    mutationFn: () => client!.runRoutine(routine.id, !routine.liveApproved),
    onSuccess: () =>
      setNotice(
        routine.liveApproved
          ? "Run started. Results will arrive in the chat."
          : "Test run started. It plans without taking real actions.",
      ),
    onSettled: invalidate,
  });
  const toggle = useMutation({
    mutationFn: () => client!.setRoutinePaused(routine.id, routine.enabled),
    onSettled: invalidate,
  });

  return (
    <Card>
      <View style={styles.head}>
        {bot ? <BotAvatar bot={bot} size={34} /> : null}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name} numberOfLines={1}>
            {routine.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {namer.name(routine.botId)} · {describeTrigger(routine.trigger)}
          </Text>
        </View>
        {routine.enabled ? (
          <Pill
            label={routine.liveApproved ? "Live" : "Test mode"}
            tone={routine.liveApproved ? "success" : "accent"}
          />
        ) : (
          <Pill label="Paused" tone="muted" />
        )}
      </View>
      <Text style={styles.prompt} numberOfLines={3}>
        {routine.prompt}
      </Text>
      {routine.lastRunAt || routine.pausedReason || routine.consecutiveFailures ? (
        <Text style={styles.detail}>
          {[
            routine.lastRunAt
              ? `Last run ${relativeTime(routine.lastRunAt).toLowerCase()}`
              : undefined,
            routine.consecutiveFailures
              ? `${routine.consecutiveFailures} failed in a row`
              : undefined,
            !routine.enabled && routine.pausedReason ? routine.pausedReason : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <ErrorText error={run.error ?? toggle.error} />
      <View style={styles.actions}>
        <Button
          compact
          variant="secondary"
          icon={routine.enabled ? "pause.fill" : "play.fill"}
          label={routine.enabled ? "Pause" : "Resume"}
          loading={toggle.isPending}
          onPress={() => toggle.mutate()}
          style={{ flex: 1 }}
        />
        <Button
          compact
          icon="bolt.fill"
          label={routine.liveApproved ? "Run now" : "Test run"}
          loading={run.isPending}
          disabled={!routine.enabled}
          onPress={() => run.mutate()}
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  head: { flexDirection: "row", alignItems: "center", gap: space[3] },
  name: { color: c.text, fontSize: type.headline, fontWeight: "700" },
  meta: { color: c.muted, fontSize: type.footnote },
  prompt: { color: c.text, fontSize: type.subhead + 1, lineHeight: 20 },
  detail: { color: c.subtle, fontSize: type.footnote },
  notice: { color: c.green, fontSize: type.footnote },
  actions: { flexDirection: "row", gap: space[2] },
}));
