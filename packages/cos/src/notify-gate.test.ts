import { describe, expect, it } from "vitest";
import type { JevAnswer } from "@openbot/contracts";
import { FakeDecisionService } from "@openbot/decisions";
import { FakeClock } from "@openbot/testkit";
import { CapCounterService, DEFAULT_AUTONOMY_CAPS } from "./caps.js";
import { evaluateNotifyRule, NotifyGate } from "./notify-gate.js";
import type { NotifyGateContext } from "./types.js";

function noul(value: number): JevAnswer {
  return { type: "noul", noul: value };
}

function baseNotifyCtx(overrides: Partial<NotifyGateContext> = {}): NotifyGateContext {
  return {
    botId: "bot_1",
    message: {
      kind: "result",
      body: "Task complete.",
      dedupeKey: "task-1",
    },
    recentDelivered: [],
    proactiveCountBotHour: 0,
    proactiveCountBotDay: 0,
    proactiveCountGlobalHour: 0,
    now: new Date("2026-09-27T12:00:00Z"),
    ...overrides,
  };
}

describe("evaluateNotifyRule", () => {
  it("delivers a final result", () => {
    const { deliver, push } = evaluateNotifyRule({
      is_final_result: noul(0.9),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.1),
    });
    expect(deliver).toBe(true);
    expect(push).toBe(false);
  });

  it("holds progress chatter (noise > 0.3)", () => {
    const { deliver } = evaluateNotifyRule({
      is_final_result: noul(0.2),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.9),
      is_time_sensitive: noul(0.1),
    });
    expect(deliver).toBe(false);
  });

  it("pushes time-sensitive blockers", () => {
    const { deliver, push } = evaluateNotifyRule({
      is_final_result: noul(0.1),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.9),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.85),
    });
    expect(deliver).toBe(true);
    expect(push).toBe(true);
  });
});

describe("NotifyGate", () => {
  it("holds progress chatter", async () => {
    const gate = new NotifyGate({
      decisions: new FakeDecisionService(),
      caps: new CapCounterService(new FakeClock()),
      autonomyCaps: DEFAULT_AUTONOMY_CAPS,
    });

    const ctx = baseNotifyCtx({
      message: { kind: "result", body: "Still working on it...", dedupeKey: "progress-1" },
    });
    const result = await gate.evaluate(ctx);
    // FakeDecisionService synthesizes 0.5 for all nouls → deliver score 0.5 < 0.7
    expect(result.allowed).toBe(false);
  });

  it("holds duplicate dedupe_key within 6h (S6)", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const gate = new NotifyGate({
      decisions: new FakeDecisionService(),
      caps: new CapCounterService(new FakeClock(now)),
      autonomyCaps: DEFAULT_AUTONOMY_CAPS,
    });

    const ctx = baseNotifyCtx({
      now,
      message: { kind: "result", body: "Done again.", dedupeKey: "task-1" },
      recentDelivered: [
        {
          dedupeKey: "task-1",
          body: "Done.",
          botId: "bot_1",
          at: new Date("2026-09-27T10:00:00Z"),
        },
      ],
    });
    const result = await gate.evaluate(ctx);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("duplicate");
    }
  });

  it("holds seventh proactive message within an hour (S5)", async () => {
    const gate = new NotifyGate({
      decisions: new FakeDecisionService(),
      caps: new CapCounterService(new FakeClock()),
      autonomyCaps: DEFAULT_AUTONOMY_CAPS,
    });

    const ctx = baseNotifyCtx({ proactiveCountGlobalHour: 6 });
    const result = await gate.evaluate(ctx);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("global hourly");
    }
  });

  it("merges messages within S10 merge window", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const gate = new NotifyGate({
      decisions: new FakeDecisionService(),
      caps: new CapCounterService(new FakeClock(now)),
      autonomyCaps: DEFAULT_AUTONOMY_CAPS,
    });

    const ctx = baseNotifyCtx({
      now,
      lastMessageFromBotAt: new Date("2026-09-27T11:55:00Z"),
    });
    const result = await gate.evaluate(ctx);
    expect(result.allowed).toBe(true);
    if (result.allowed && result.details) {
      expect(result.details.outcome).toBe("merged");
    }
  });
});
