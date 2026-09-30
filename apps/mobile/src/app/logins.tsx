import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Text } from "react-native";
import { OfflineCard } from "@/components/ConnectionStatus";
import { EmptyState, ErrorText, Icon, Row, RowGroup, Screen, Section } from "@/components/ui";
import { ApiError, type SavedLogin } from "@/connection/client";
import { useConnection } from "@/connection/ConnectionProvider";
import { relativeTime } from "@/lib/format";
import { useLogins, useRefresh } from "@/lib/queries";
import { makeStyles, space, type, useTheme } from "@/theme";

/**
 * Website logins saved on the desktop. Bots never see them: the desktop types them into its
 * virtual machine when a task reaches a sign-in form. The phone can review and remove them;
 * passwords never leave the desktop, so adding one stays there.
 */
export default function LoginsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { state, client } = useConnection();
  const refresh = useRefresh();
  const logins = useLogins();
  const queryClient = useQueryClient();
  const connected = state.status === "connected";
  const remove = useMutation({
    mutationFn: (site: string) => client!.deleteLogin(site),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["openbot", "logins"] }),
  });
  const list = logins.data?.logins ?? [];
  const forbidden = logins.error instanceof ApiError && logins.error.status === 403;

  const confirmRemove = (login: SavedLogin) =>
    Alert.alert(
      `Remove the login for ${login.site}?`,
      "Bots will have to ask you to sign in to this site again.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => remove.mutate(login.site) },
      ],
    );

  return (
    <Screen {...(connected ? refresh : {})}>
      <OfflineCard />
      {connected && forbidden ? (
        <EmptyState
          icon="lock.fill"
          title="Owner access needed"
          detail="This iPhone was paired as an approver. Pair it as an owner to manage saved logins."
        />
      ) : null}
      {connected && list.length ? (
        <Section>
          <RowGroup>
            {list.map((login) => (
              <Row
                key={login.site}
                leading={<Icon name="key.fill" size={16} color={colors.amber} />}
                title={login.site}
                subtitle={[
                  login.username ?? "No username",
                  login.hasPassword ? "Password saved" : "No password",
                  `Updated ${relativeTime(login.updatedAt).replace("Just now", "just now")}`,
                ].join(" · ")}
                numberOfLines={2}
                onPress={() => confirmRemove(login)}
                trailing={<Icon name="trash" size={15} color={colors.red} />}
              />
            ))}
          </RowGroup>
        </Section>
      ) : null}
      {connected && logins.data && !list.length ? (
        <EmptyState
          icon="key"
          title="No saved logins"
          detail="Save a website login on your desktop and Bots can sign in to that site in their virtual computer."
        />
      ) : null}
      <ErrorText error={remove.error ?? (forbidden ? undefined : logins.error)} />
      {connected && list.length ? (
        <Text style={styles.note}>
          Passwords never leave your desktop. Bots don&apos;t see them either: OpenBot types them in
          when a task reaches the sign-in form. Add new logins on the desktop.
        </Text>
      ) : null}
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  note: {
    color: c.muted,
    fontSize: type.footnote,
    lineHeight: 18,
    paddingHorizontal: space[2],
  },
}));
