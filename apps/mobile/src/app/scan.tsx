import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";
import { parsePairingQr } from "@/lib/pairing";
import { useConnection } from "@/connection/ConnectionProvider";

export default function PairingScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string>();
  const [scanned, setScanned] = useState(false);
  const scanLocked = useRef(false);
  const { pair } = useConnection();

  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (scanLocked.current) return;
    scanLocked.current = true;
    setScanned(true);
    try {
      parsePairingQr(data);
      void pair(data).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Pairing failed. Try again.");
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That QR code could not be read.");
    }
  };

  if (!permission?.granted) {
    return (
      <View style={styles.permission}>
        <Text style={styles.title}>Allow camera access</Text>
        <Text style={styles.body}>
          Use your camera to scan the pairing QR shown in OpenBot Settings → Devices.
        </Text>
        <Pressable onPress={() => void requestPermission()} style={styles.button}>
          <Text style={styles.buttonLabel}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onBarcodeScanned}
      />
      <View style={styles.overlay}>
        <View style={styles.frame} />
        <Text style={styles.hint}>
          {error ?? (scanned ? "Pairing securely…" : "Point your camera at the pairing QR code")}
        </Text>
        {error && (
          <Pressable
            onPress={() => {
              setError(undefined);
              setScanned(false);
              scanLocked.current = false;
            }}
            style={styles.button}
          >
            <Text style={styles.buttonLabel}>Scan again</Text>
          </Pressable>
        )}
        <Pressable onPress={() => router.back()}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: "rgba(5,10,18,0.42)",
    gap: 24,
  },
  frame: { width: 260, height: 260, borderColor: colors.accent, borderWidth: 2, borderRadius: 28 },
  hint: { color: colors.text, textAlign: "center", fontSize: 15, lineHeight: 22 },
  cancel: { color: colors.accent, fontWeight: "700", padding: 12 },
  permission: {
    flex: 1,
    justifyContent: "center",
    padding: 28,
    gap: 16,
    backgroundColor: colors.background,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: "700" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  button: { backgroundColor: colors.accent, borderRadius: 14, padding: 15, alignItems: "center" },
  buttonLabel: { color: "#071425", fontWeight: "700" },
});
