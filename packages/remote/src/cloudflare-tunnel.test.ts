import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CloudflareManager, type SpawnFn } from "./cloudflare-manager.js";
import {
  CLOUDFLARE_TOKEN_VAULT_KEY,
  hasCloudflareToken,
  removeCloudflareTunnel,
  resumeCloudflareTunnel,
  startCloudflareTunnel,
  type CloudflareTunnelContext,
} from "./cloudflare-tunnel.js";
import { readNetworkPrefs, writeNetworkPrefs } from "./network-prefs.js";

const TOKEN = Buffer.from(JSON.stringify({ a: "acct", t: "tunnel", s: "secret" })).toString(
  "base64",
);
const OTHER_TOKEN = Buffer.from(JSON.stringify({ a: "acct", t: "tunnel2", s: "secret2" })).toString(
  "base64",
);

let home: string | undefined;
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true });
  home = undefined;
});

interface Harness {
  ctx: CloudflareTunnelContext;
  secrets: Map<string, string>;
  spawned: string[][];
  events: unknown[];
  setup: Record<string, unknown>;
}

async function harness(options: { failStart?: boolean } = {}): Promise<Harness> {
  home = await mkdtemp(join(tmpdir(), "ob-cft-"));
  const secrets = new Map<string, string>();
  const spawned: string[][] = [];
  const events: unknown[] = [];
  const setup: Record<string, unknown> = {};
  const spawnFn: SpawnFn = (_command, args) => {
    spawned.push(args);
    const child = new EventEmitter() as ChildProcess;
    child.stdout = new EventEmitter() as ChildProcess["stdout"];
    child.stderr = new EventEmitter() as ChildProcess["stderr"];
    child.kill = () => true;
    Object.defineProperty(child, "killed", { value: false });
    queueMicrotask(() => {
      if (options.failStart) child.stderr?.emit("data", Buffer.from("ERR bad token"));
      else child.emit("spawn");
    });
    return child;
  };
  const ctx = {
    clock: { now: () => new Date() },
    config: { port: 4577, openbotHome: home },
    vault: {
      get: async (key: string) => secrets.get(key),
      set: async (key: string, value: string) => void secrets.set(key, value),
      delete: async (key: string) => void secrets.delete(key),
    },
    repos: {
      setupState: {
        get: () => setup,
        patch: (p: Record<string, unknown>) => Object.assign(setup, p),
      },
    },
    eventBus: { publish: async (event: unknown) => void events.push(event) },
    remote: { cloudflare: new CloudflareManager(spawnFn) },
  } as unknown as CloudflareTunnelContext;
  return { ctx, secrets, spawned, events, setup };
}

describe("saved Cloudflare tunnel", () => {
  it("saves the token to the vault once the tunnel starts, never before", async () => {
    const failing = await harness({ failStart: true });
    const bad = await startCloudflareTunnel(failing.ctx, TOKEN);
    expect(bad.ok).toBe(false);
    expect(await hasCloudflareToken(failing.ctx)).toBe(false);

    const good = await harness();
    const ok = await startCloudflareTunnel(good.ctx, `cloudflared service install ${TOKEN}`);
    expect(ok.ok).toBe(true);
    expect(good.secrets.get(CLOUDFLARE_TOKEN_VAULT_KEY)).toBe(TOKEN);
    expect(good.setup.cloudflare).toEqual({ ok: true });
  });

  it("restarts from the saved token, and resume brings it back at startup", async () => {
    const h = await harness();
    h.secrets.set(CLOUDFLARE_TOKEN_VAULT_KEY, TOKEN);
    const result = await resumeCloudflareTunnel(h.ctx);
    expect(result?.ok).toBe(true);
    expect(h.spawned[0]).toEqual(["tunnel", "run", "--token", TOKEN]);
  });

  it("does nothing at startup when no tunnel is configured", async () => {
    const h = await harness();
    expect(await resumeCloudflareTunnel(h.ctx)).toBeUndefined();
    expect(h.spawned).toEqual([]);
    expect(await startCloudflareTunnel(h.ctx)).toEqual({
      ok: false,
      reason: "no saved tunnel token",
    });
  });

  it("replaces the saved token when the owner pastes a different one", async () => {
    const h = await harness();
    await startCloudflareTunnel(h.ctx, TOKEN);
    await startCloudflareTunnel(h.ctx, OTHER_TOKEN);
    expect(h.secrets.get(CLOUDFLARE_TOKEN_VAULT_KEY)).toBe(OTHER_TOKEN);
  });

  it("removing forgets the token and the public hostname", async () => {
    const h = await harness();
    await startCloudflareTunnel(h.ctx, TOKEN);
    await writeNetworkPrefs(home!, { cloudflareHostname: "openbot.example.com" });
    h.ctx.remote!.cloudflare.setManualHostname("openbot.example.com");

    await removeCloudflareTunnel(h.ctx);

    expect(await hasCloudflareToken(h.ctx)).toBe(false);
    expect(readNetworkPrefs(home!).cloudflareHostname).toBeUndefined();
    expect(h.ctx.remote!.cloudflare.status().hostname).toBeUndefined();
    expect(h.setup.cloudflare).toEqual({ ok: false });
  });
});
