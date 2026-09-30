import type { Clock } from "@openbot/contracts";
import { CloudflareManager } from "./cloudflare-manager.js";
import { ensureCloudflared } from "./cloudflared-binary.js";
import { join } from "node:path";
import { E2EFraming } from "./framing.js";
import { generateX25519KeyPair, type X25519KeyPair } from "./crypto.js";
import { PairingService } from "./pairing.js";
import { TailscaleManager } from "./tailscale-manager.js";

const VAULT_HOST_KEY = "remote.hostX25519Private";

interface SecretVault {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}
import type { PushService } from "./push/service.js";

export interface RemoteServicesOptions {
  clock: Clock;
  vault?: SecretVault;
  tailscale?: TailscaleManager;
  cloudflare?: CloudflareManager;
  hostKeys?: X25519KeyPair;
  /** OpenBot's data directory; a downloaded `cloudflared` is kept in its `bin/`. */
  openbotHome?: string;
}

/** Everything WS11 owns, wired once at harness boot. */
export interface RemoteServices {
  pairing: PairingService;
  framing: E2EFraming;
  tailscale: TailscaleManager;
  cloudflare: CloudflareManager;
  hostKeys: X25519KeyPair;
  /** APNs notifications to paired iPhones; attached with the core context. */
  push?: PushService;
}

export async function createRemoteServices(
  options: RemoteServicesOptions,
): Promise<RemoteServices> {
  const hostKeys = options.hostKeys ?? (await loadOrCreateHostKeys(options.vault));
  return {
    pairing: new PairingService(options.clock, hostKeys),
    framing: new E2EFraming(),
    tailscale: options.tailscale ?? new TailscaleManager(),
    cloudflare:
      options.cloudflare ??
      (options.openbotHome
        ? new CloudflareManager(undefined, "cloudflared", () =>
            ensureCloudflared({ binDir: join(options.openbotHome!, "bin") }),
          )
        : new CloudflareManager()),
    hostKeys,
  };
}

async function loadOrCreateHostKeys(vault?: SecretVault): Promise<X25519KeyPair> {
  if (!vault) return generateX25519KeyPair();
  const existing = await vault.get(VAULT_HOST_KEY);
  if (existing) {
    const { createPrivateKey, createPublicKey } = await import("node:crypto");
    const privateKey = createPrivateKey({
      key: Buffer.from(existing, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const publicKey = createPublicKey(privateKey);
    return {
      privateKey,
      publicKey,
      publicKeyBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    };
  }
  const keys = generateX25519KeyPair();
  await vault.set(
    VAULT_HOST_KEY,
    keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  );
  return keys;
}

/** Collects reachable base URLs for QR pairing (LAN hostname + tailnet + tunnel). */
export function collectPairingUrls(input: {
  port: number;
  tailscaleUrls?: string[];
  cloudflareHostname?: string;
  lanHost?: string;
}): string[] {
  const urls = new Set<string>();
  const lanHost = input.lanHost ?? `127.0.0.1:${input.port}`;
  urls.add(`http://${lanHost}`);
  urls.add(`http://127.0.0.1:${input.port}`);
  for (const url of input.tailscaleUrls ?? []) urls.add(url);
  if (input.cloudflareHostname) urls.add(`https://${input.cloudflareHostname}`);
  return [...urls];
}

export function primaryPairingHost(urls: string[]): string {
  const https = urls.find((url) => url.startsWith("https://"));
  if (https) return https.replace(/^https:\/\//, "").replace(/\/$/, "");
  const first = urls[0] ?? "127.0.0.1:4577";
  return first.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
