import type { Approval } from "@openbot/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { useConnection } from "@/connection/ConnectionProvider";
import {
  APPROVAL_TITLES,
  approvalAction,
  approvalTarget,
  humanReason,
  parseApproval,
  relativeTime,
} from "@/lib/format";
import { useNamer } from "@/lib/queries";
import { makeStyles, space, type } from "@/theme";
import { BotAvatar, Button, Card, ErrorText, Mono, Pill } from "./ui";

export function ApprovalCard({ approval, compact }: { approval: Approval; compact?: boolean }) {
  const styles = useStyles();
  const { client } = useConnection();
  const queryClient = useQueryClient();
  const namer = useNamer();
  const bot = namer.get(approval.botId);
  const resolve = useMutation({
    mutationFn: (decision: "allow" | "deny") => client!.resolveApproval(approval.id, decision),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["openbot"] }),
  });
  const target = approvalTarget(approval);
  const { reason } = parseApproval(approval);
  const risk =
    approval.risk === undefined
      ? undefined
      : approval.risk >= 0.66
        ? "High risk"
        : approval.risk >= 0.33
          ? "Medium risk"
          : "Low risk";

  return (
    <Card tone="warning">
      <View style={styles.head}>
        {bot ? <BotAvatar bot={bot} size={30} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.who} numberOfLines={1}>
            {namer.name(approval.botId)} · {APPROVAL_TITLES[approval.kind]}
          </Text>
          <Text style={styles.when}>{relativeTime(approval.createdAt)}</Text>
        </View>
        {risk ? <Pill label={risk} tone={risk === "High risk" ? "danger" : "warning"} /> : null}
      </View>
      <Text style={styles.action}>{approvalAction(approval, namer.humanize)}</Text>
      {target ? <Mono>{target}</Mono> : null}
      {!compact && reason ? (
        <Text style={styles.reason}>{humanReason(namer.humanize(reason))}</Text>
      ) : null}
      <ErrorText error={resolve.error} />
      <View style={styles.actions}>
        <Button
          label="Deny"
          variant="secondary"
          style={{ flex: 1 }}
          disabled={resolve.isPending}
          onPress={() => resolve.mutate("deny")}
        />
        <Button
          label="Approve"
          icon="checkmark"
          style={{ flex: 1 }}
          loading={resolve.isPending && resolve.variables === "allow"}
          disabled={resolve.isPending}
          onPress={() => resolve.mutate("allow")}
        />
      </View>
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  head: { flexDirection: "row", alignItems: "center", gap: space[3] },
  who: { color: c.text, fontSize: type.subhead, fontWeight: "600" },
  when: { color: c.subtle, fontSize: type.caption, marginTop: 1 },
  action: { color: c.text, fontSize: type.headline + 1, fontWeight: "700" },
  reason: { color: c.muted, fontSize: type.subhead, lineHeight: 19 },
  actions: { flexDirection: "row", gap: space[2] },
}));
