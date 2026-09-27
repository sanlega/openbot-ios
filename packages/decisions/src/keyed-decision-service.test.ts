import { describe, expect, it, vi } from "vitest";
import type { DecideResult, DecisionService } from "@openbot/contracts";
import { KeyedDecisionService, UNCONFIGURED_MODEL } from "./keyed-decision-service.js";
import { buildSpawnQuestions } from "./questions/spawn.js";

const riskRequest = {
  purpose: "risk" as const,
  state: { action: "write_file" },
  questions: {
    external_side_effect: {
      type: "score" as const,
      instructions: "How large is the side effect?",
      criteria: ["none", "minor, reversible", "moderate", "major, irreversible"],
    },
  },
};

function stubService(model: string): DecisionService {
  const result: DecideResult = {
    answers: {},
    provider: "jev",
    model,
    latencyMs: 1,
    decisionId: "dec_stub",
  };
  return {
    decide: vi.fn(async () => result),
    route: vi.fn(),
    band: vi.fn(),
    budgets: vi.fn(() => ({})),
    validateKey: vi.fn(),
  } as unknown as DecisionService;
}

describe("KeyedDecisionService", () => {
  it("without a key, degrades conservatively instead of faking Jev", async () => {
    const create = vi.fn();
    const service = new KeyedDecisionService({ getApiKey: async () => undefined, create });

    const risk = await service.decide(riskRequest);
    expect(risk.provider).toBe("heuristic");
    expect(risk.model).toBe(UNCONFIGURED_MODEL);
    const answer = risk.answers.external_side_effect;
    expect(answer?.type).toBe("score");
    if (answer?.type !== "score") throw new Error("expected score");
    expect(answer.score).toBe(3);
    expect(service.band(answer.confidence, "risk")).not.toBe("auto");

    const spawn = await service.decide({
      purpose: "spawn",
      state: { request: "summarize my inbox once" },
      questions: buildSpawnQuestions({}),
    });
    const route = spawn.answers.route;
    expect(route?.type === "choice" && route.choice).toBe("cos_itself");

    expect(create).not.toHaveBeenCalled();
    expect(await service.configured()).toBe(false);
  });

  it("picks up a key saved after startup, and rebuilds when it changes", async () => {
    let key: string | undefined;
    const create = vi.fn((apiKey: string) => stubService(`jev-for-${apiKey}`));
    const service = new KeyedDecisionService({ getApiKey: async () => key, create });

    expect((await service.decide(riskRequest)).model).toBe(UNCONFIGURED_MODEL);

    key = "ts_key_a";
    expect((await service.decide(riskRequest)).model).toBe("jev-for-ts_key_a");
    expect((await service.decide(riskRequest)).model).toBe("jev-for-ts_key_a");
    expect(create).toHaveBeenCalledTimes(1);

    key = "ts_key_b";
    expect((await service.decide(riskRequest)).model).toBe("jev-for-ts_key_b");
    expect(create).toHaveBeenCalledTimes(2);

    key = "";
    expect((await service.decide(riskRequest)).model).toBe(UNCONFIGURED_MODEL);
  });

  it("validates keys against Jev, never accepting an arbitrary string", async () => {
    const probeKey = vi.fn(async (apiKey: string) => ({ ok: apiKey === "ts_valid" }));
    const service = new KeyedDecisionService({ getApiKey: async () => undefined, probeKey });

    expect(await service.validateKey("   ")).toEqual({ ok: false });
    expect(probeKey).not.toHaveBeenCalled();
    expect(await service.validateKey("not-a-real-key")).toEqual({ ok: false });
    expect(await service.validateKey(" ts_valid ")).toEqual({ ok: true });
    expect(probeKey).toHaveBeenLastCalledWith("ts_valid");
  });
});
