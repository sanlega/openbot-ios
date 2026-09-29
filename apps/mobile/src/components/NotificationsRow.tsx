import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Switch, Text, View } from "react-native";
import { useConnection } from "@/connection/ConnectionProvider";
import { enablePush } from "@/connection/push";
import { makeStyles, space, type, useTheme } from "@/theme";
import { Icon, Row } from "./ui";

/** Turns desktop-sent notifications on or off for this iPhone. */
export function NotificationsRow() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { client } = useConnection();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const status = useQuery({
    queryKey: ["openbot", "push"],
    queryFn: () => client!.getPushStatus(),
    enabled: !!client,
  });
  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      setError(undefined);
      if (on) await enablePush(client!);
      else await client!.unregisterPush();
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Couldn't change notifications."),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["openbot", "push"] }),
  });

  const on = status.data?.registered ?? false;
  const subtitle = error
    ? undefined
    : on && status.data?.configured === false
      ? "On. Your desktop still needs its Apple key: Settings → Devices → Phone notifications."
      : on
        ? "Approvals, questions, and replies arrive even when OpenBot is closed."
        : "Get told when a Bot needs you, even with the app closed.";

  return (
    <View>
      <Row
        leading={
          <View style={styles.badge}>
            <Icon name="bell.badge.fill" size={15} color={colors.red} />
          </View>
        }
        title="Notifications"
        subtitle={subtitle}
        numberOfLines={3}
        trailing={
          <Switch
            value={toggle.isPending ? (toggle.variables ?? on) : on}
            disabled={!client || status.isLoading || toggle.isPending}
            onValueChange={(value) => toggle.mutate(value)}
            trackColor={{ true: colors.green }}
            accessibilityLabel="Notifications"
          />
        }
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  badge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    color: c.red,
    fontSize: type.footnote,
    lineHeight: 17,
    paddingHorizontal: space[4],
    paddingBottom: space[3],
  },
}));
