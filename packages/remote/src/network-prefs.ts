import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

/** Owner's network choices, read before the server binds (so not in the database). */
export interface NetworkPrefs {
  /** "Allow phones on this Wi-Fi": listen on the local network, not only this computer. */
  lanAccess: boolean;
  /** Public hostname of the owner's Cloudflare tunnel, for the pairing QR (cloudflared's logs don't reliably reveal it). */
  cloudflareHostname?: string;
}

const FILE = "network.json";

export function readNetworkPrefs(openbotHome: string): NetworkPrefs {
  try {
    const parsed = JSON.parse(
      readFileSync(join(openbotHome, FILE), "utf8"),
    ) as Partial<NetworkPrefs>;
    const cloudflareHostname = normalizeHostname(parsed.cloudflareHostname ?? "");
    return {
      lanAccess: parsed.lanAccess === true,
      ...(cloudflareHostname ? { cloudflareHostname } : {}),
    };
  } catch {
    return { lanAccess: false };
  }
}

/**
 * Merges `patch` into the saved prefs. Written to a temp file and renamed, so the server never
 * reads a half-written file at startup (which would silently fall back to "LAN off").
 * A `cloudflareHostname` of `undefined` in the patch clears it.
 */
export async function writeNetworkPrefs(
  openbotHome: string,
  patch: Partial<NetworkPrefs>,
): Promise<void> {
  await mkdir(openbotHome, { recursive: true });
  const merged: NetworkPrefs = { ...readNetworkPrefs(openbotHome), ...patch };
  if (!merged.cloudflareHostname) delete merged.cloudflareHostname;
  const target = join(openbotHome, FILE);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(merged, null, 2)}\n`);
  await rename(temp, target);
}

/** `https://Foo.example.com:443/app` becomes `foo.example.com`; undefined if it isn't a hostname. */
export function normalizeHostname(input: string): string | undefined {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "");
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    ? host
    : undefined;
}

/**
 * This computer's addresses on private networks (home/office Wi-Fi), which a
 * phone on the same network can reach. Excludes loopback, link-local, and
 * public addresses.
 */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (isPrivateIPv4(addr.address)) out.push(addr.address);
    }
  }
  return out;
}

export function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === undefined || b === undefined) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
