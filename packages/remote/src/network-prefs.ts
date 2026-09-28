import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

/** Owner's network choices, read before the server binds (so not in the database). */
export interface NetworkPrefs {
  /** "Allow phones on this Wi-Fi": listen on the local network, not only this computer. */
  lanAccess: boolean;
}

const FILE = "network.json";

export function readNetworkPrefs(openbotHome: string): NetworkPrefs {
  try {
    const parsed = JSON.parse(
      readFileSync(join(openbotHome, FILE), "utf8"),
    ) as Partial<NetworkPrefs>;
    return { lanAccess: parsed.lanAccess === true };
  } catch {
    return { lanAccess: false };
  }
}

export async function writeNetworkPrefs(openbotHome: string, prefs: NetworkPrefs): Promise<void> {
  await mkdir(openbotHome, { recursive: true });
  await writeFile(join(openbotHome, FILE), `${JSON.stringify(prefs, null, 2)}\n`);
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
