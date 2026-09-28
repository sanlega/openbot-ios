import { Link } from "expo-router";
import { Alert, Pressable, StyleSheet, Text } from "react-native";
import { ConnectionNotice } from "@/components/ConnectionNotice";
import { EmptyCard, Screen, SectionTitle } from "@/components/Screen";
import { useConnection } from "@/connection/ConnectionProvider";
import { colors } from "@/theme";

export default function SettingsScreen() {
  const { forget, state } = useConnection();
  const clear = () =>
    Alert.alert("Forget this phone?", "You will need to scan a pairing QR to connect again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Forget", style: "destructive", onPress: () => void forget() },
    ]);
  return (
    <Screen>
      <SectionTitle>Connection</SectionTitle>
      <ConnectionNotice />
      {state.status === "connected" ? (
        <Pressable onPress={clear} style={styles.button}>
          <Text style={styles.buttonText}>Forget this phone</Text>
        </Pressable>
      ) : (
        <Link href="/scan" asChild>
          <Pressable style={styles.button}>
            <Text style={styles.buttonText}>Pair with desktop</Text>
          </Pressable>
        </Link>
      )}
      <SectionTitle>Notifications</SectionTitle>
      <EmptyCard
        title="Push notifications are optional"
        detail="OpenBot has no hosted relay. Approvals and updates remain available when you open the app and reconnect; reliable remote push would need an optional APNs sender or relay running with your desktop."
      />
      <SectionTitle>Privacy</SectionTitle>
      <EmptyCard
        title="OpenBot remains the source of truth"
        detail="This phone stores only its paired device credentials in iOS Keychain. Bot conversations and agent execution remain on your desktop."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 13,
  },
  buttonText: { color: colors.text, fontWeight: "700" },
});
