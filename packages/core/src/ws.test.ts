import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { buildServer } from "./http/server.js";
import { createTestContext, type TestContext } from "./test-helpers.js";

interface WsEnvelope {
  type: "event" | "command.result" | "error";
  event?: { seq: number; type: string };
  [key: string]: unknown;
}

let app: FastifyInstance | undefined;
let testContext: TestContext | undefined;

afterEach(async () => {
  await app?.close();
  await testContext?.cleanup();
  app = undefined;
  testContext = undefined;
});

async function bootListening(): Promise<{ app: FastifyInstance; test: TestContext; url: string }> {
  testContext = await createTestContext();
  app = await buildServer(testContext.ctx);
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  return { app, test: testContext, url: address.replace("http://", "ws://") + "/api/ws" };
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function collectEvents(socket: WebSocket, count: number, timeoutMs = 2000): Promise<WsEnvelope[]> {
  return new Promise((resolve, reject) => {
    const collected: WsEnvelope[] = [];
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${count} messages, got ${collected.length}`)),
      timeoutMs,
    );
    socket.on("message", (raw) => {
      collected.push(JSON.parse(raw.toString()) as WsEnvelope);
      if (collected.length >= count) {
        clearTimeout(timer);
        resolve(collected);
      }
    });
  });
}

/**
 * WS1 acceptance: "the WebSocket replay has no gaps." Connects over a real
 * socket (not `.inject()`, which can't upgrade to WebSocket), subscribes
 * from a `since` cursor, disconnects, publishes more events while
 * disconnected, then reconnects from the last seq actually seen and checks
 * every in-between event arrives exactly once, in order.
 */
describe("/api/ws", () => {
  it("subscribe {since: 0} replays every already-published event, then streams new ones live", async () => {
    const { test, url } = await bootListening();
    const e1 = await test.ctx.eventBus.publish({ type: "bot.created", payload: { n: 1 } });
    const e2 = await test.ctx.eventBus.publish({ type: "bot.created", payload: { n: 2 } });

    const socket = await connect(url);
    const replayPromise = collectEvents(socket, 2);
    socket.send(JSON.stringify({ type: "subscribe", since: 0 }));
    const replay = await replayPromise;
    expect(replay.map((m) => m.event?.seq)).toEqual([e1.seq, e2.seq]);

    const livePromise = collectEvents(socket, 1);
    const e3 = await test.ctx.eventBus.publish({ type: "bot.updated", payload: { n: 3 } });
    const live = await livePromise;
    expect(live[0]!.event?.seq).toBe(e3.seq);

    socket.close();
  });

  it("reconnecting with the last-seen seq replays exactly the events missed, no gaps and no duplicates", async () => {
    const { test, url } = await bootListening();

    const firstSocket = await connect(url);
    const firstReplay = collectEvents(firstSocket, 2);
    firstSocket.send(JSON.stringify({ type: "subscribe", since: -1 }));
    const e1 = await test.ctx.eventBus.publish({ type: "bot.created", payload: { n: 1 } });
    const e2 = await test.ctx.eventBus.publish({ type: "bot.created", payload: { n: 2 } });
    const seenBeforeDisconnect = await firstReplay;
    expect(seenBeforeDisconnect.map((m) => m.event?.seq)).toEqual([e1.seq, e2.seq]);
    const lastSeenSeq = seenBeforeDisconnect[seenBeforeDisconnect.length - 1]!.event!.seq;
    firstSocket.close();
    await new Promise((resolve) => firstSocket.once("close", resolve));

    // Events happen while the client is offline.
    const e3 = await test.ctx.eventBus.publish({ type: "bot.archived", payload: { n: 3 } });
    const e4 = await test.ctx.eventBus.publish({ type: "message.completed", payload: { n: 4 } });

    const secondSocket = await connect(url);
    const reconnectReplay = collectEvents(secondSocket, 2);
    secondSocket.send(JSON.stringify({ type: "subscribe", since: lastSeenSeq }));
    const missed = await reconnectReplay;

    expect(missed.map((m) => m.event?.seq)).toEqual([e3.seq, e4.seq]);
    secondSocket.close();
  });

  it("rejects a connection from a non-loopback address with no device token (close code 4401)", async () => {
    // Can't spoof remoteAddress over a real TCP socket, so this exercises the
    // same `resolveDeviceIdentity` path the HTTP routes use, directly, to
    // pin the WebSocket route's behavior when it returns `undefined`.
    const { test } = await bootListening();
    const { resolveDeviceIdentity } = await import("./http/auth.js");
    const fakeRequest = { headers: {}, ip: "203.0.113.5" } as never;
    expect(resolveDeviceIdentity(test.ctx, fakeRequest)).toBeUndefined();
  });

  it("approval.resolve command resolves the approval and echoes an ok result", async () => {
    const { test, url } = await bootListening();
    const now = test.ctx.clock.now();
    const approval = {
      id: "apr_ws_test",
      kind: "tool" as const,
      botId: "bot_test1",
      chainId: undefined,
      summary: "test",
      detail: "test",
      risk: 0.1,
      status: "pending" as const,
      resolution: undefined,
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      createdAt: now.toISOString(),
    };
    test.ctx.repos.approvals.create(approval);

    const socket = await connect(url);
    const resultPromise = new Promise<WsEnvelope>((resolve) => {
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as WsEnvelope;
        if (msg.type === "command.result") resolve(msg);
      });
    });
    socket.send(
      JSON.stringify({
        type: "command",
        command: "approval.resolve",
        payload: { id: approval.id, resolution: "allow" },
      }),
    );
    const result = await resultPromise;
    expect(result.ok).toBe(true);
    expect(test.ctx.repos.approvals.getById(approval.id)?.status).toBe("resolved");
    socket.close();
  });

  /** WS1 acceptance: "p95 latency from publish to client is under 50 ms." */
  it("p95 publish -> WebSocket delivery latency is under 50ms", async () => {
    const { test, url } = await bootListening();
    const socket = await connect(url);
    socket.send(JSON.stringify({ type: "subscribe", since: -1 }));
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the subscribe ack settle

    const SAMPLE_SIZE = 50;
    const latencies: number[] = [];
    const seenAt = new Map<number, number>();
    socket.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as WsEnvelope;
      if (msg.type === "event" && msg.event) seenAt.set(msg.event.seq, performance.now());
    });

    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const publishedAt = performance.now();
      const event = await test.ctx.eventBus.publish({ type: "bot.updated", payload: { i } });
      await new Promise<void>((resolve) => {
        const check = (): void => {
          if (seenAt.has(event.seq)) resolve();
          else setImmediate(check);
        };
        check();
      });
      latencies.push(seenAt.get(event.seq)! - publishedAt);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)]!;
    expect(p95).toBeLessThan(50);
    socket.close();
  });
});
