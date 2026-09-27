import { describe, expect, it } from "vitest";
import type { DecisionService, JevAnswer } from "@openbot/contracts";
import { FakeDecisionService } from "@openbot/decisions";
import { FakeClock } from "@openbot/testkit";
import { CapCounterService, DEFAULT_AUTONOMY_CAPS } from "./caps.js";
import { evaluateSpawnRule, SpawnGate } from "./spawn-gate.js";
import type { SpawnGateContext } from "./types.js";

function noul(id: string, value: number): JevAnswer {
  return { type: "noul", noul: value };
}

function choice(id: string, choiceVal: string, confidence: number): JevAnswer {
  return { type: "choice", choice: choiceVal, confidence, probabilities: {} };
}

function baseContext(overrides: Partial<SpawnGateContext> = {}): SpawnGateContext {
  return {
    request: {
      name: "Research Bot",
      description: "Handles research tasks",
      responsibility: "Research and summarize topics",
      whyNotExisting: "No existing bot covers research",
      lifetime: "recurring",
      boundary: ["web search"],
      userRequested: false,
    },
    roster: [],
    recentUserMessages: [],
    cosCreatedBotCount: 0,
    spawnsInLast24h: 0,
    ...overrides,
  };
}

describe("evaluateSpawnRule", () => {
  it("denies one-off tasks (one_off > 0.4)", () => {
    const result = evaluateSpawnRule({
      route: choice("route", "new_bot", 0.9),
      user_requested: noul("user_requested", 0.1),
      existing_can_do: noul("existing_can_do", 0.1),
      one_off: noul("one_off", 0.9),
      recurring_ownership: noul("recurring_ownership", 0.1),
      distinct_boundary: noul("distinct_boundary", 0.1),
      duplicates_existing: noul("duplicates_existing", 0.1),
    });
    expect(result.allow).toBe(false);
    expect(result.suggestion).toBe("cos_itself");
  });

  it("allows explicit user request (user_requested >= 0.8)", () => {
    const result = evaluateSpawnRule({
      route: choice("route", "new_bot", 0.5),
      user_requested: noul("user_requested", 0.9),
      existing_can_do: noul("existing_can_do", 0.5),
      one_off: noul("one_off", 0.5),
      recurring_ownership: noul("recurring_ownership", 0.5),
      distinct_boundary: noul("distinct_boundary", 0.5),
      duplicates_existing: noul("duplicates_existing", 0.5),
    });
    expect(result.allow).toBe(true);
  });

  it("allows recurring work with distinct boundary", () => {
    const result = evaluateSpawnRule({
      route: choice("route", "new_bot", 0.85),
      user_requested: noul("user_requested", 0.1),
      existing_can_do: noul("existing_can_do", 0.1),
      one_off: noul("one_off", 0.1),
      recurring_ownership: noul("recurring_ownership", 0.2),
      distinct_boundary: noul("distinct_boundary", 0.85),
      duplicates_existing: noul("duplicates_existing", 0.1),
    });
    expect(result.allow).toBe(true);
  });

  it("denies when existing bot can do it", () => {
    const result = evaluateSpawnRule({
      route: choice("route", "new_bot", 0.85),
      user_requested: noul("user_requested", 0.1),
      existing_can_do: noul("existing_can_do", 0.9),
      one_off: noul("one_off", 0.1),
      recurring_ownership: noul("recurring_ownership", 0.8),
      distinct_boundary: noul("distinct_boundary", 0.8),
      duplicates_existing: noul("duplicates_existing", 0.1),
    });
    expect(result.allow).toBe(false);
  });
});

describe("SpawnGate", () => {
  it("refuses third spawn within 24h", async () => {
    const gate = new SpawnGate({
      decisions: new FakeDecisionService(),
      caps: new CapCounterService(new FakeClock()),
      autonomyCaps: DEFAULT_AUTONOMY_CAPS,
    });

    const ctx = baseContext({ spawnsInLast24h: 2 });
    const result = await gate.evaluate(ctx);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("daily spawn cap");
    }
  });

  it("refuses spawn within 30 min cooldown", async () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const gate = new SpawnGate({
      decisions: new FakeDecisionService(),
      caps: new CapCounterService(new FakeClock(now)),
      autonomyCaps: DEFAULT_AUTONOMY_CAPS,
      now,
    });

    const ctx = baseContext({
      lastSpawnAt: new Date("2026-09-27T11:45:00Z"),
    });
    const result = await gate.evaluate(ctx);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("cooldown");
    }
  });

  it("refuses at roster cap S1", async () => {
    const gate = new SpawnGate({
      decisions: new FakeDecisionService(),
      caps: new CapCounterService(new FakeClock()),
      autonomyCaps: DEFAULT_AUTONOMY_CAPS,
    });

    const ctx = baseContext({ cosCreatedBotCount: 6 });
    const result = await gate.evaluate(ctx);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.suggestion).toContain("archive");
    }
  });

  it("allows explicit user-requested spawn", async () => {
    const decisions: DecisionService = {
      async decide() {
        return {
          answers: {
            route: choice("route", "new_bot", 0.5),
            user_requested: noul("user_requested", 0.95),
            existing_can_do: noul("existing_can_do", 0.5),
            one_off: noul("one_off", 0.5),
            recurring_ownership: noul("recurring_ownership", 0.5),
            distinct_boundary: noul("distinct_boundary", 0.5),
            duplicates_existing: noul("duplicates_existing", 0.5),
          },
          provider: "heuristic",
          model: "test",
          latencyMs: 1,
          decisionId: "dec_test",
        };
      },
      route: async () => ({ engine: "fake", model: "fake", band: "auto", decisionId: "dec_test" }),
      band: () => "auto",
      budgets: () => ({
        gates: { limitRpm: 0, usedRpm: 0, queued: 0 },
        interactive: { limitRpm: 0, usedRpm: 0, queued: 0 },
        computer: { limitRpm: 0, usedRpm: 0, queued: 0 },
        background: { limitRpm: 0, usedRpm: 0, queued: 0 },
      }),
      validateKey: async () => ({ ok: true }),
    };

    const gate = new SpawnGate({
      decisions,
      caps: new CapCounterService(new FakeClock()),
      autonomyCaps: DEFAULT_AUTONOMY_CAPS,
    });

    const ctx = baseContext({
      request: { ...baseContext().request, userRequested: true },
    });
    const result = await gate.evaluate(ctx);
    expect(result.allowed).toBe(true);
  });
});
