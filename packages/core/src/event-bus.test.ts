import { describe, expect, it } from "vitest";
import { EventStore } from "@openbot/store";
import { FakeClock } from "@openbot/testkit";
import { EventBus } from "./event-bus.js";
import { NullNdjsonWriter } from "./ndjson-writer.js";
import { createTestContext } from "./test-helpers.js";

/**
 * WS1 acceptance: "the WebSocket replay has no gaps." `replaySince` reads
 * from the same durable log `publish()` writes to, so any subscriber that
 * disconnects and later replays from the last `seq` it saw must see every
 * event in between, in order, exactly once.
 */
describe("EventBus", () => {
  it("publish() persists before notifying subscribers, and returns the assigned seq", async () => {
    const { ctx, cleanup } = await createTestContext();
    try {
      const received: number[] = [];
      ctx.eventBus.subscribe((event) => received.push(event.seq));

      const first = await ctx.eventBus.publish({ type: "bot.created", payload: { note: "one" } });
      const second = await ctx.eventBus.publish({ type: "bot.created", payload: { note: "two" } });

      expect(second.seq).toBeGreaterThan(first.seq);
      expect(received).toEqual([first.seq, second.seq]);
      expect(ctx.eventBus.replaySince(0).map((e) => e.seq)).toEqual([first.seq, second.seq]);
    } finally {
      await cleanup();
    }
  });

  it("replaySince(since) is gap-free across a simulated disconnect/reconnect", async () => {
    const { ctx, cleanup } = await createTestContext();
    try {
      const beforeDisconnect: number[] = [];
      const unsubscribe = ctx.eventBus.subscribe((event) => beforeDisconnect.push(event.seq));

      const e1 = await ctx.eventBus.publish({ type: "bot.created", payload: {} });
      const e2 = await ctx.eventBus.publish({ type: "bot.updated", payload: {} });
      unsubscribe(); // client disconnects after seeing e1, e2

      // Events keep happening while the client is offline.
      const e3 = await ctx.eventBus.publish({ type: "bot.archived", payload: {} });
      const e4 = await ctx.eventBus.publish({ type: "message.completed", payload: {} });

      // Reconnect: replay from the last seq the client actually saw.
      const lastSeenSeq = beforeDisconnect[beforeDisconnect.length - 1]!;
      const backlog = ctx.eventBus.replaySince(lastSeenSeq);

      expect(backlog.map((e) => e.seq)).toEqual([e3.seq, e4.seq]);
      expect([e1.seq, e2.seq, e3.seq, e4.seq]).toEqual([
        ...new Set([e1.seq, e2.seq, e3.seq, e4.seq]),
      ]); // no duplicate seqs
    } finally {
      await cleanup();
    }
  });

  it("subscribe() returns a working unsubscribe function", async () => {
    const { ctx, cleanup } = await createTestContext();
    try {
      const received: number[] = [];
      const unsubscribe = ctx.eventBus.subscribe((event) => received.push(event.seq));
      expect(ctx.eventBus.subscriberCount).toBe(1);

      await ctx.eventBus.publish({ type: "bot.created", payload: {} });
      unsubscribe();
      await ctx.eventBus.publish({ type: "bot.created", payload: {} });

      expect(received).toHaveLength(1);
      expect(ctx.eventBus.subscriberCount).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it("replaySince(0) returns every event ever published, oldest first", async () => {
    const { ctx, cleanup } = await createTestContext();
    try {
      const store = new EventStore(ctx.db);
      const bus = new EventBus(store, new NullNdjsonWriter(), new FakeClock());
      await bus.publish({ type: "bot.created", payload: { n: 1 } });
      await bus.publish({ type: "bot.created", payload: { n: 2 } });
      await bus.publish({ type: "bot.created", payload: { n: 3 } });

      const all = bus.replaySince(0);
      expect(all.map((e) => (e.payload as { n: number }).n)).toEqual([1, 2, 3]);
      expect(all).toEqual([...all].sort((a, b) => a.seq - b.seq));
    } finally {
      await cleanup();
    }
  });
});
