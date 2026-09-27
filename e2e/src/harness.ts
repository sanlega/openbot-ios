import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FileVault } from "@openbot/core";
import { SessionTokenService } from "@openbot/mcp";

const require = createRequire(import.meta.url);
const serverIndex = require.resolve("@openbot/server");
const serverMain = join(dirname(serverIndex), "main.js");

/** Where the E2E harness points Jev: the in-process fake, or a scripted HTTP fake. */
export type JevTarget = { kind: "fake" } | { kind: "http"; url: string; apiKey: string };

export interface HarnessOptions {
  /** Reuse an `OPENBOT_HOME` (e.g. to restart over the same data). */
  home?: string;
  jev?: JevTarget;
}

export interface TestHarness {
  baseUrl: string;
  home: string;
  /** Stops the server; the data dir survives until {@link TestHarness.close}. */
  stop: () => Promise<void>;
  /** Stops the server and deletes its data dir. */
  close: () => Promise<void>;
}

/**
 * Starts `openbot serve` on a random loopback port with fake engines, a fake
 * computer and fake Composio. Jev is the in-process fake unless `jev` points
 * the server at an HTTP endpoint (the real `DecisionService` then runs).
 */
export async function startTestHarness(options: HarnessOptions = {}): Promise<TestHarness> {
  const home = options.home ?? (await mkdtemp(join(tmpdir(), "openbot-e2e-")));
  const port = 18000 + Math.floor(Math.random() * 1000);
  const jev = options.jev ?? { kind: "fake" };
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENBOT_HOME: home,
    PORT: String(port),
    OPENBOT_FAKE_ENGINES: "1",
    OPENBOT_FAKE_COMPUTER: "1",
    OPENBOT_FAKE_COMPOSIO: "1",
    ...(jev.kind === "fake"
      ? { OPENBOT_FAKE_JEV: "1", JEV_API_KEY: "" }
      : { OPENBOT_FAKE_JEV: "", JEV_API_KEY: jev.apiKey, JEV_BASE_URL: jev.url }),
  };

  const child: ChildProcess = spawn(process.execPath, [serverMain, "serve"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHarness(baseUrl);
  } catch (error) {
    child.kill("SIGKILL");
    throw new Error(`${(error as Error).message}\n--- server output ---\n${output}`, {
      cause: error,
    });
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000);
    });
  };

  return {
    baseUrl,
    home,
    stop,
    close: async () => {
      await stop();
      await rm(home, { recursive: true, force: true });
    },
  };
}

async function waitForHarness(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/harness/status`);
      if (res.ok) {
        const body = (await res.json()) as { connected?: boolean };
        if (body.connected) return;
      }
    } catch {
      // server still booting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Harness did not become ready in time");
}

/** JSON request against the Client API; returns status and parsed body. */
export async function api<T = Record<string, unknown>>(
  harness: TestHarness,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${harness.baseUrl}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

export interface CreatedBot {
  bot: { id: string; slug: string; isChiefOfStaff: boolean };
  thread: { id: string };
}

export async function createBot(
  harness: TestHarness,
  input: Record<string, unknown>,
): Promise<CreatedBot> {
  const res = await api<CreatedBot>(harness, "/api/bots", { body: input });
  if (res.status !== 201) throw new Error(`create bot failed: ${JSON.stringify(res)}`);
  return res.body;
}

/**
 * Signs a per-turn session token exactly as the harness does for an engine
 * turn, with the secret the harness keeps in its vault. This lets a test play
 * the engine's part: call `/internal/tools/*` the way the OpenBot MCP shim does.
 */
export async function sessionTokenFor(
  harness: TestHarness,
  claims: { botId: string; chainId?: string; turnId?: string; mode?: "live" | "dry_run" },
): Promise<string> {
  const vault = new FileVault(join(harness.home, "vault.bin"), join(harness.home, "vault.key"));
  const secret = await vault.get("mcp.sessionTokenSecret");
  if (!secret) throw new Error("harness has no MCP session secret yet");
  return new SessionTokenService(Buffer.from(secret, "hex")).issue({
    botId: claims.botId,
    chainId: claims.chainId ?? "chn_e2e",
    turnId: claims.turnId ?? "turn_e2e",
    mode: claims.mode ?? "live",
  });
}

/** Calls an OpenBot MCP tool as the engine would, through the loopback tool route. */
export async function callTool<T = Record<string, unknown>>(
  harness: TestHarness,
  token: string,
  tool: string,
  input: Record<string, unknown>,
): Promise<T> {
  const res = await api<T>(harness, `/internal/tools/${tool}`, {
    body: input,
    headers: { "x-openbot-session": token },
  });
  if (res.status !== 200) throw new Error(`${tool} → HTTP ${res.status}: ${JSON.stringify(res)}`);
  return res.body;
}

export interface WsClient {
  command<T = Record<string, unknown>>(
    command: string,
    payload: Record<string, unknown>,
  ): Promise<T & { ok: boolean; reason?: string }>;
  /** Resolves with the first streamed event matching `predicate`, including ones already received. */
  waitForEvent(
    predicate: (event: StreamedEvent) => boolean,
    timeoutMs?: number,
  ): Promise<StreamedEvent>;
  close(): void;
}

export interface StreamedEvent {
  type: string;
  botId?: string;
  threadId?: string;
  chainId?: string;
  turnId?: string;
  payload: Record<string, unknown>;
}

/** Opens `/api/ws` as the local owner and subscribes to the live event stream. */
export async function connectWs(harness: TestHarness): Promise<WsClient> {
  const socket = new WebSocket(`${harness.baseUrl.replace("http", "ws")}/api/ws`);
  const events: StreamedEvent[] = [];
  const eventWaiters: Array<() => void> = [];
  const results: Array<(frame: Record<string, unknown>) => void> = [];

  socket.addEventListener("message", (message) => {
    const frame = JSON.parse(String(message.data)) as Record<string, unknown>;
    if (frame.type === "event") {
      events.push(frame.event as StreamedEvent);
      for (const wake of eventWaiters.splice(0)) wake();
    } else if (frame.type === "command.result") {
      results.shift()?.(frame);
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("ws connect failed")), { once: true });
  });
  socket.send(JSON.stringify({ type: "subscribe" }));

  return {
    command: (command, payload) =>
      new Promise((resolve) => {
        results.push(resolve as (frame: Record<string, unknown>) => void);
        socket.send(JSON.stringify({ type: "command", command, payload }));
      }),
    waitForEvent: async (predicate, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = events.find(predicate);
        if (found) return found;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(`no matching event; saw: ${events.map((e) => e.type).join(", ")}`);
        }
        await new Promise<void>((resolve) => {
          eventWaiters.push(resolve);
          setTimeout(resolve, remaining);
        });
      }
    },
    close: () => socket.close(),
  };
}

/** Polls `check` until it returns a value, for state the API exposes but does not stream. */
export async function eventually<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 100));
  }
}
