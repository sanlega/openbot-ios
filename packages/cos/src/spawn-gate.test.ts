import { describe, expect, it } from "vitest";
import type { DecisionService, JevAnswer } from "@openbot/contracts";
import { FakeDecisionService } from "@openbot/decisions";
import { FakeClock } from "@openbot/testkit";
import { CapCounterService, DEFAULT_AUTONOMY_CAPS } from "./caps.js";
import { evaluateSpawnRule, SpawnGate } from "./spawn-gate.js";
import type { SpawnGateContext } from "./types.js";

/** The conservative limits these tests are about; the shipped defaults are looser so the Chief can delegate freely. */
const STRICT_CAPS = {
  ...DEFAULT_AUTONOMY_CAPS,
  cosCreatedBotsMax: 6,
  newBotsPerDay: 2,
  spawnCooldownMin: 30,
};

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

  it("allows a one-off task when it is substantial work, so the Chief stays free", () => {
    const result = evaluateSpawnRule({
      route: choice("route", "new_bot", 0.9),
      user_requested: noul("user_requested", 0.1),
      existing_can_do: noul("existing_can_do", 0.1),
      one_off: noul("one_off", 0.9),
      substantial_work: noul("substantial_work", 0.9),
      recurring_ownership: noul("recurring_ownership", 0.1),
      distinct_boundary: noul("distinct_boundary", 0.1),
      duplicates_existing: noul("duplicates_existing", 0.1),
    });
    expect(result.allow).toBe(true);
  });

  it("still denies a quick one-off that is not substantial work", () => {
    const result = evaluateSpawnRule({
      route: choice("route", "new_bot", 0.9),
      user_requested: noul("user_requested", 0.1),
      existing_can_do: noul("existing_can_do", 0.1),
      one_off: noul("one_off", 0.9),
      substantial_work: noul("substantial_work", 0.2),
      recurring_ownership: noul("recurring_ownership", 0.1),
      distinct_boundary: noul("distinct_boundary", 0.1),
      duplicates_existing: noul("duplicates_existing", 0.1),
    });
    expect(result.allow).toBe(false);
  });

  it("does not spawn for substantial work an existing bot can take", () => {
    const result = evaluateSpawnRule({
      route: choice("route", "new_bot", 0.9),
      user_requested: noul("user_requested", 0.1),
      existing_can_do: noul("existing_can_do", 0.9),
      one_off: noul("one_off", 0.9),
      substantial_work: noul("substantial_work", 0.9),
      recurring_ownership: noul("recurring_ownership", 0.1),
      distinct_boundary: noul("distinct_boundary", 0.1),
      duplicates_existing: noul("duplicates_existing", 0.1),
    });
    expect(result.allow).toBe(false);
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

  it("allows a very confident new_bot call despite existing_can_do missing its normal ceiling (the 0.97/0.32 near-miss found in live testing)", () => {
    const result = evaluateSpawnRule({
      route: choice("route", "new_bot", 0.97),
      user_requested: noul("user_requested", 0.03),
      existing_can_do: noul("existing_can_do", 0.32),
      one_off: noul("one_off", 0.03),
      recurring_ownership: noul("recurring_ownership", 0.98),
      distinct_boundary: noul("distinct_boundary", 0.63),
      duplicates_existing: noul("duplicates_existing", 0.16),
    });
    expect(result.allow).toBe(true);
  });

  it("still denies a very confident new_bot call if existing_can_do is genuinely high, not just borderline", () => {
    const result = evaluateSpawnRule({
      route: choice("route", "new_bot", 0.97),
      user_requested: noul("user_requested", 0.03),
      existing_can_do: noul("existing_can_do", 0.8),
      one_off: noul("one_off", 0.03),
      recurring_ownership: noul("recurring_ownership", 0.98),
      distinct_boundary: noul("distinct_boundary", 0.63),
      duplicates_existing: noul("duplicates_existing", 0.16),
    });
    expect(result.allow).toBe(false);
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
      autonomyCaps: STRICT_CAPS,
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
      autonomyCaps: STRICT_CAPS,
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

  it("measures the cooldown against the clock at evaluation time, not construction", async () => {
    const clock = new FakeClock(new Date("2026-09-27T12:00:00Z"));
    const gate = new SpawnGate({
      decisions: new FakeDecisionService(),
      caps: new CapCounterService(clock),
      autonomyCaps: STRICT_CAPS,
    });

    clock.advance(2 * 60 * 60_000);
    const result = await gate.evaluate(
      baseContext({ lastSpawnAt: new Date("2026-09-27T13:50:00Z") }),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain("wait 20 min");
  });

  it("refuses at roster cap S1", async () => {
    const gate = new SpawnGate({
      decisions: new FakeDecisionService(),
      caps: new CapCounterService(new FakeClock()),
      autonomyCaps: STRICT_CAPS,
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
      autonomyCaps: STRICT_CAPS,
    });

    const ctx = baseContext({
      request: { ...baseContext().request, userRequested: true },
    });
    const result = await gate.evaluate(ctx);
    expect(result.allowed).toBe(true);
  });
});
