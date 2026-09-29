import { z } from "zod";
import { parsePairingQr, phonePairingUrls } from "@/lib/pairing";
import {
  framingKeyFor,
  makeDeviceKeys,
  open,
  seal,
  toBase64,
  encodeText,
  decodeText,
} from "./native-crypto";
import { saveCredentials, type DeviceCredentials } from "./storage";

const PairResult = z.object({
  device: z.object({ id: z.string().min(1) }),
  token: z.string().min(1),
});

export async function pairFromQr(qrUrl: string): Promise<DeviceCredentials> {
  const qr = parsePairingQr(qrUrl);
  const keys = await makeDeviceKeys();
  const key = await framingKeyFor(qr.hostPub, keys.privateKey);
  const failures: string[] = [];
  const addresses = phonePairingUrls(qr.urls);

  for (const address of addresses) {
    const baseUrl = address.replace(/\/$/, "");
    const controller = new AbortController();
    try {
      const sealed = seal(
        key,
        encodeText(
          JSON.stringify({
            pairSecret: qr.pairSecret,
            devicePub: keys.publicKeySpki,
            name: "OpenBot iPhone",
            via: viaFor(address),
          }),
        ),
      );
      const timeout = setTimeout(() => controller.abort(), 8000);
      let response: Response;
      try {
        response = await fetch(new URL("/api/devices/pair/complete", baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-openbot-pair-pub": keys.publicKeySpki,
          },
          body: JSON.stringify({ sealed }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const body = (await response.json()) as { sealed?: unknown; error?: unknown };
      if (!response.ok || typeof body.sealed !== "string") {
        failures.push(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
        continue;
      }
      const result = PairResult.parse(JSON.parse(decodeText(open(key, body.sealed))));
      const credentials: DeviceCredentials = {
        baseUrl,
        deviceId: result.device.id,
        token: result.token,
        hostPub: qr.hostPub,
        devicePrivateKey: toBase64(keys.privateKey),
      };
      await saveCredentials(credentials);
      return credentials;
    } catch (error) {
      // A timed-out request surfaces as a native cancel error on iOS, not a TypeError.
      if (controller.signal.aborted || error instanceof TypeError) failures.push("unreachable");
      else if (error instanceof Error) failures.push(error.message);
      else failures.push("pairing failed");
    }
  }

  if (
    failures.some((failure) =>
      ["invalid_pair_secret", "pair_secret_reused", "pair_secret_expired"].includes(failure),
    )
  ) {
    throw new Error(
      "This pairing code expired or was already used. Create a new code on your desktop.",
    );
  }
  const firstPairingError = failures.find((failure) => failure !== "unreachable");
  if (firstPairingError) throw new Error(`Pairing failed: ${firstPairingError}`);
  const hosts = addresses.map((address) => new URL(address).host).join(", ");
  throw new Error(
    `Could not reach OpenBot at ${hosts || "any address"}. Check that this iPhone is on the same Wi-Fi as the desktop and that the desktop allows phones on this Wi-Fi.`,
  );
}

function viaFor(address: string): "lan" | "tailscale" | "cloudflare" {
  const url = new URL(address);
  if (url.protocol === "http:") return "lan";
  return url.hostname.endsWith(".ts.net") ? "tailscale" : "cloudflare";
}
