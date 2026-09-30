import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isPrivateIPv4,
  normalizeHostname,
  readNetworkPrefs,
  writeNetworkPrefs,
} from "./network-prefs.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("network prefs", () => {
  it("defaults to off and remembers the owner's choice", async () => {
    dir = await mkdtemp(join(tmpdir(), "ob-net-"));
    expect(readNetworkPrefs(dir)).toEqual({ lanAccess: false });
    await writeNetworkPrefs(dir, { lanAccess: true });
    expect(readNetworkPrefs(dir)).toEqual({ lanAccess: true });
  });

  it("keeps the tunnel hostname when LAN access changes, and can clear it", async () => {
    dir = await mkdtemp(join(tmpdir(), "ob-net-"));
    await writeNetworkPrefs(dir, { cloudflareHostname: "openbot.example.com" });
    await writeNetworkPrefs(dir, { lanAccess: true });
    expect(readNetworkPrefs(dir)).toEqual({
      lanAccess: true,
      cloudflareHostname: "openbot.example.com",
    });
    await writeNetworkPrefs(dir, { cloudflareHostname: undefined });
    expect(readNetworkPrefs(dir)).toEqual({ lanAccess: true });
  });

  it("normalizes a pasted URL to a bare hostname and rejects junk", () => {
    expect(normalizeHostname(" https://OpenBot.Example.com/app#pair=x ")).toBe(
      "openbot.example.com",
    );
    expect(normalizeHostname("openbot.example.com:443")).toBe("openbot.example.com");
    expect(normalizeHostname("localhost")).toBeUndefined();
    expect(normalizeHostname("not a host")).toBeUndefined();
    expect(normalizeHostname("")).toBeUndefined();
  });

  it("only offers private network addresses", () => {
    expect(isPrivateIPv4("192.168.1.20")).toBe(true);
    expect(isPrivateIPv4("10.0.0.5")).toBe(true);
    expect(isPrivateIPv4("172.20.3.4")).toBe(true);
    expect(isPrivateIPv4("172.40.3.4")).toBe(false);
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
  });
});
