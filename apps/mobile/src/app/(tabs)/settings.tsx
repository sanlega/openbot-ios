import { router } from "expo-router";
import { Alert, Text, View } from "react-native";
import { ConnectionChip } from "@/components/ConnectionStatus";
import { NotificationsRow } from "@/components/NotificationsRow";
import { Icon, Row, RowGroup, Screen, Section } from "@/components/ui";
import { useConnection } from "@/connection/ConnectionProvider";
import { useHealth, useRoutines } from "@/lib/queries";
import { makeStyles, space, type, useTheme, type Palette } from "@/theme";
import type { SFSymbol } from "expo-symbols";
import app from "../../../app.json";

export default function SettingsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { forget, state, client } = useConnection();
  const health = useHealth();
  const routines = useRoutines();
  const connected = state.status === "connected";
  const paired = state.status !== "disconnected" && state.status !== "revoked";
  const host = client ? new URL(client.baseUrl).host : undefined;

  const confirmForget = () =>
    Alert.alert(
      "Unpair this iPhone?",
      "It will stop receiving updates. You can pair again at any time with a new QR code.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Unpair", style: "destructive", onPress: () => void forget() },
      ],
    );

  return (
    <Screen title="Settings">
      <Section title="Desktop">
        <RowGroup>
          <Row
            leading={<Badge icon="desktopcomputer" color={colors.accent} colors={colors} />}
            title={paired ? "OpenBot desktop" : "No desktop paired"}
            subtitle={
              paired
                ? [host, health.data?.version ? `v${health.data.version}` : undefined]
                    .filter(Boolean)
                    .join(" · ")
                : "Scan a QR code from your desktop to connect."
            }
            trailing={<ConnectionChip />}
          />
          {paired ? (
            <Row
              leading={<Badge icon="qrcode" color={colors.muted} colors={colors} />}
              title="Pair a different desktop"
              onPress={() => router.push("/scan")}
              chevron
            />
          ) : (
            <Row
              leading={<Badge icon="qrcode.viewfinder" color={colors.accent} colors={colors} />}
              title="Pair a desktop"
              onPress={() => router.push("/scan")}
              chevron
            />
          )}
        </RowGroup>
      </Section>

      {connected ? (
        <Section title="Notifications">
          <RowGroup>
            <NotificationsRow />
          </RowGroup>
        </Section>
      ) : null}

      {connected ? (
        <Section title="Automation">
          <RowGroup>
            <Row
              leading={<Badge icon="clock.arrow.circlepath" color={colors.green} colors={colors} />}
              title="Routines"
              subtitle={
                routines.data
                  ? `${routines.data.routines.filter((r) => r.enabled).length} active of ${routines.data.routines.length}`
                  : undefined
              }
              onPress={() => router.push("/routines")}
              chevron
            />
          </RowGroup>
        </Section>
      ) : null}

      <Section title="Privacy">
        <RowGroup>
          <Row
            leading={<Badge icon="lock.fill" color={colors.green} colors={colors} />}
            title="End-to-end encrypted"
            subtitle="Every request and live update between this iPhone and your desktop is encrypted with keys only the two of them hold."
            numberOfLines={4}
          />
          <Row
            leading={<Badge icon="key.fill" color={colors.amber} colors={colors} />}
            title="Stored in Keychain"
            subtitle="This iPhone keeps only its pairing keys. Conversations and Bot work stay on your desktop."
            numberOfLines={3}
          />
        </RowGroup>
      </Section>

      {paired ? (
        <Section>
          <RowGroup>
            <Row title="Unpair this iPhone" destructive onPress={confirmForget} />
          </RowGroup>
        </Section>
      ) : null}

      <View style={styles.footer}>
        <Icon name="sparkles" size={14} color={colors.subtle} />
        <Text style={styles.footerText}>OpenBot for iPhone {app.expo.version}</Text>
      </View>
    </Screen>
  );
}

function Badge({ icon, color, colors }: { icon: SFSymbol; color: string; colors: Palette }) {
  return (
    <View
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        backgroundColor: colors.surfaceRaised,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={icon} size={15} color={color} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    paddingTop: space[2],
  },
  footerText: { color: c.subtle, fontSize: type.footnote },
}));
