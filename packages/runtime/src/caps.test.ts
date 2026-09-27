import { FakeClock } from "@openbot/testkit";
import { describe, expect, it } from "vitest";
import { InMemorySpendLedger, SpendCaps } from "./caps.js";
import { InMemoryEventSink } from "./event-sink.js";
import {
  PassthroughNotifyGate,
  type NotifyGate,
  type NotifyRequest,
  type NotifyResult,
} from "./notify-gate.js";

class RecordingNotifyGate implements NotifyGate {
  readonly requests: NotifyRequest[] = [];
  async notify(req: NotifyRequest): Promise<NotifyResult> {
    this.requests.push(req);
    return { delivery: "delivered", pushed: req.kind === "blocker" };
  }
}

function setup() {
  const events = new InMemoryEventSink();
  const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
  const ledger = new InMemorySpendLedger();
  const notify = new RecordingNotifyGate();
  const caps = new SpendCaps({ ledger, notify, events, clock });
  return { events, clock, ledger, notify, caps };
}

describe("SpendCaps (plan §5 WS2 S8: per turn, per Bot per day, and global)", () => {
  it("allows a turn when under both caps", async () => {
    const { caps } = setup();
    const result = await caps.checkBeforeTurn({
      botId: "bot_a",
      dailyUsdPerBot: 5,
      dailyUsdGlobal: 100,
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks a turn once the bot's own daily cap is reached, and emits cap.hit + a blocker via NotifyGate", async () => {
    const { caps, ledger, events, notify } = setup();
    ledger.add("bot", "bot_a", "2026-01-01", { usd: 5, tokens: 0 });
    const result = await caps.checkBeforeTurn({
      botId: "bot_a",
      dailyUsdPerBot: 5,
      dailyUsdGlobal: 100,
    });
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe("bot");
    expect(events.byType("cap.hit")).toHaveLength(1);
    expect(notify.requests).toHaveLength(1);
    expect(notify.requests[0]?.kind).toBe("blocker");
  });

  it("blocks a turn once the global daily cap is reached, even if the bot's own cap is fine", async () => {
    const { caps, ledger } = setup();
    ledger.add("global", "global", "2026-01-01", { usd: 100, tokens: 0 });
    const result = await caps.checkBeforeTurn({
      botId: "bot_a",
      dailyUsdPerBot: 5,
      dailyUsdGlobal: 100,
    });
    expect(result.allowed).toBe(false);
    expect(result.scope).toBe("global");
  });

  it("recordUsage accumulates spend and interrupts once a cap is crossed mid-turn", async () => {
    const { caps } = setup();
    const ok = await caps.recordUsage({ botId: "bot_a", usd: 3, tokens: 100, dailyUsdPerBot: 5 });
    expect(ok.allowed).toBe(true);
    const crossed = await caps.recordUsage({
      botId: "bot_a",
      usd: 3,
      tokens: 100,
      dailyUsdPerBot: 5,
    });
    expect(crossed.allowed).toBe(false);
  });

  it("emits exactly one usage.recorded event per recordUsage call, with running totals", async () => {
    const { caps, events } = setup();
    await caps.recordUsage({ botId: "bot_a", usd: 1, tokens: 10 });
    await caps.recordUsage({ botId: "bot_a", usd: 2, tokens: 20 });
    const recorded = events.byType("usage.recorded");
    expect(recorded).toHaveLength(2);
    expect(recorded[1]?.payload.botDailyUsd).toBe(3);
  });

  it("sends only ONE blocker message per Bot per day, even across repeated cap hits", async () => {
    const { caps, notify } = setup();
    await caps.checkBeforeTurn({ botId: "bot_a", dailyUsdPerBot: 0 });
    await caps.checkBeforeTurn({ botId: "bot_a", dailyUsdPerBot: 0 });
    await caps.recordUsage({ botId: "bot_a", usd: 1, tokens: 0, dailyUsdPerBot: 0 });
    expect(notify.requests).toHaveLength(1);
  });

  it("sends a fresh blocker the next day", async () => {
    const { caps, notify, clock } = setup();
    await caps.checkBeforeTurn({ botId: "bot_a", dailyUsdPerBot: 0 });
    clock.advance(24 * 60 * 60_000);
    await caps.checkBeforeTurn({ botId: "bot_a", dailyUsdPerBot: 0 });
    expect(notify.requests).toHaveLength(2);
  });

  it("suppresses the blocker when sendBlocker is explicitly false", async () => {
    const { caps, notify } = setup();
    await caps.checkBeforeTurn({ botId: "bot_a", dailyUsdPerBot: 0, sendBlocker: false });
    expect(notify.requests).toHaveLength(0);
  });

  it("remainingUsd is the minimum of the bot's own headroom and the global headroom", () => {
    const { caps, ledger } = setup();
    ledger.add("bot", "bot_a", "2026-01-01", { usd: 2, tokens: 0 });
    ledger.add("global", "global", "2026-01-01", { usd: 8, tokens: 0 });
    expect(caps.remainingUsd("bot_a", 5, 10)).toBe(2);
  });

  it("remainingUsd never goes negative", () => {
    const { caps, ledger } = setup();
    ledger.add("bot", "bot_a", "2026-01-01", { usd: 10, tokens: 0 });
    expect(caps.remainingUsd("bot_a", 5)).toBe(0);
  });

  it("remainingUsd is undefined when no cap is configured", () => {
    const { caps } = setup();
    expect(caps.remainingUsd("bot_a")).toBeUndefined();
  });
});

describe("InMemorySpendLedger", () => {
  it("keeps bot and global totals independent per day", () => {
    const ledger = new InMemorySpendLedger();
    ledger.add("bot", "bot_a", "2026-01-01", { usd: 1, tokens: 10 });
    ledger.add("bot", "bot_b", "2026-01-01", { usd: 2, tokens: 20 });
    ledger.add("bot", "bot_a", "2026-01-02", { usd: 5, tokens: 50 });
    expect(ledger.get("bot", "bot_a", "2026-01-01")).toEqual({ usd: 1, tokens: 10 });
    expect(ledger.get("bot", "bot_b", "2026-01-01")).toEqual({ usd: 2, tokens: 20 });
    expect(ledger.get("bot", "bot_a", "2026-01-02")).toEqual({ usd: 5, tokens: 50 });
  });
});

describe("PassthroughNotifyGate", () => {
  it("delivers everything and pushes only blockers", async () => {
    const gate = new PassthroughNotifyGate();
    const result = await gate.notify({ botId: "bot_a", kind: "result", body: "done" });
    expect(result.delivery).toBe("delivered");
    expect(result.pushed).toBe(false);
    const blocker = await gate.notify({ botId: "bot_a", kind: "blocker", body: "stuck" });
    expect(blocker.pushed).toBe(true);
  });
});
