import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Icon } from "@/components/ui";
import { useConnection } from "@/connection/ConnectionProvider";
import { parsePairingQr } from "@/lib/pairing";
import { makeStyles, radius, space, type, useTheme } from "@/theme";

type Phase = "scanning" | "pairing" | "failed";

export default function PairingScanScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>("scanning");
  const [error, setError] = useState<string>();
  const [manual, setManual] = useState(false);
  const [link, setLink] = useState("");
  const locked = useRef(false);
  const { pair } = useConnection();

  const start = (data: string) => {
    if (locked.current) return;
    locked.current = true;
    setError(undefined);
    try {
      parsePairingQr(data.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That code could not be read.");
      setPhase("failed");
      return;
    }
    setPhase("pairing");
    pair(data.trim()).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Pairing failed. Try again.");
      setPhase("failed");
    });
  };

  const retry = () => {
    setError(undefined);
    setPhase("scanning");
    locked.current = false;
  };

  const cameraReady = permission?.granted && !manual;

  return (
    <View style={styles.root}>
      {cameraReady ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={phase === "scanning" ? ({ data }) => start(data) : undefined}
        />
      ) : null}
      <View style={[styles.scrim, !cameraReady && { backgroundColor: colors.background }]} />

      <KeyboardAvoidingView behavior="padding" style={styles.layout}>
        <View style={styles.top}>
          {cameraReady ? (
            <View style={styles.frame}>
              {(["tl", "tr", "bl", "br"] as const).map((corner) => (
                <View key={corner} style={[styles.corner, styles[corner]]} />
              ))}
            </View>
          ) : (
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Icon name="qrcode.viewfinder" size={34} color={colors.accent} />
              </View>
            </View>
          )}
        </View>

        <View style={styles.sheet}>
          <Text style={styles.title}>
            {phase === "pairing"
              ? "Pairing securely…"
              : phase === "failed"
                ? "Couldn't pair"
                : manual
                  ? "Paste the pairing link"
                  : "Scan the pairing code"}
          </Text>
          <Text style={[styles.body, phase === "failed" && { color: colors.red }]}>
            {phase === "failed"
              ? error
              : phase === "pairing"
                ? "Exchanging keys with your desktop. This takes a moment."
                : manual
                  ? "On your desktop open Settings → Devices → Pair a phone, copy the link, and paste it here."
                  : "On your desktop open Settings → Devices → Pair a phone and point the camera at the QR code."}
          </Text>

          {manual && phase !== "pairing" ? (
            <TextInput
              value={link}
              onChangeText={setLink}
              placeholder="https://…/app#pair=…"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
              multiline
            />
          ) : null}

          {phase === "failed" ? (
            <Button label="Try again" icon="arrow.clockwise" onPress={retry} />
          ) : phase === "pairing" ? (
            <Button label="Pairing…" onPress={() => undefined} loading />
          ) : manual ? (
            <Button label="Pair" icon="link" disabled={!link.trim()} onPress={() => start(link)} />
          ) : !permission?.granted ? (
            <Button label="Allow camera" icon="camera" onPress={() => void requestPermission()} />
          ) : null}

          <View style={styles.links}>
            {phase !== "pairing" ? (
              <Button
                variant="ghost"
                compact
                label={manual ? "Use the camera" : "Paste a link instead"}
                onPress={() => {
                  retry();
                  setManual((value) => !value);
                }}
              />
            ) : null}
            <Button variant="ghost" compact label="Cancel" onPress={() => router.back()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const CORNER = 34;

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: "#000" },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  layout: { flex: 1, justifyContent: "space-between" },
  top: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: { width: 250, height: 250 },
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: "#FFFFFF" },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 22 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 22 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 22 },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 22,
  },
  hero: { alignItems: "center" },
  heroIcon: {
    width: 84,
    height: 84,
    borderRadius: 26,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: {
    margin: space[3],
    padding: space[5],
    borderRadius: radius.xl + 4,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    gap: space[3],
  },
  title: { color: c.text, fontSize: type.title3, fontWeight: "700" },
  body: { color: c.muted, fontSize: type.subhead + 1, lineHeight: 20 },
  input: {
    minHeight: 64,
    maxHeight: 120,
    color: c.text,
    backgroundColor: c.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: space[3],
    fontSize: type.subhead + 1,
  },
  links: { flexDirection: "row", justifyContent: "space-between" },
}));
