import { describe, expect, it } from "vitest";
import { type DecideRequest, bandConfidence, bandNoul } from "@openbot/contracts";
import { FakeDecisionService } from "./fake-decision-service.js";

describe("FakeDecisionService", () => {
  it("decide() answers every question and returns a well-formed DecideResult", async () => {
    const service = new FakeDecisionService();
    const req: DecideRequest = {
      purpose: "route",
      state: "test state",
      questions: {
        route: {
          type: "choice",
          instructions: "who owns this?",
          criteria: { a: "option a", b: "option b" },
        },
        urgent: { type: "noul", instructions: "is this urgent?" },
      },
    };

    const result = await service.decide(req);

    expect(Object.keys(result.answers).sort()).toEqual(["route", "urgent"]);
    expect(result.provider).toBe("heuristic");
    expect(result.decisionId.startsWith("dec_")).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("band() matches the shared bandConfidence helper", () => {
    const service = new FakeDecisionService();
    expect(service.band(0.95, "route")).toBe(bandConfidence(0.95));
    expect(service.band(0.6, "route")).toBe(bandConfidence(0.6));
    expect(service.band(0.1, "route")).toBe(bandConfidence(0.1));
  });

  it("budgets() reports all four budgets with configured rpm limits", () => {
    const service = new FakeDecisionService({ interactive: 200 });
    const budgets = service.budgets();
    expect(Object.keys(budgets).sort()).toEqual(["background", "computer", "gates", "interactive"]);
    expect(budgets.interactive.limitRpm).toBe(200);
    expect(budgets.interactive.usedRpm).toBe(0);
  });

  it("validateKey() rejects an empty key and accepts a non-empty one", async () => {
    const service = new FakeDecisionService();
    await expect(service.validateKey("")).resolves.toMatchObject({ ok: false });
    await expect(service.validateKey("sk-abc")).resolves.toMatchObject({ ok: true });
  });

  it("noul answers band via bandNoul, not bandConfidence, since they carry no confidence", async () => {
    const service = new FakeDecisionService();
    const req: DecideRequest = {
      purpose: "triage",
      state: "test",
      questions: { x: { type: "noul", instructions: "?" } },
    };
    const result = await service.decide(req);
    const answer = result.answers.x;
    expect(answer?.type).toBe("noul");
    if (answer?.type === "noul") {
      expect(bandNoul(answer.noul)).toBeDefined();
    }
  });
});
