import { describe, expect, it } from "vitest";
import type { DecideRequest } from "@openbot/contracts";
import { FakeEngineDriver } from "@openbot/engines-fake";
import {
  buildStructuredPrompt,
  EngineLlmFallback,
  parseStructuredAnswers,
  runOneShotTurn,
} from "./llm-fallback.js";

describe("EngineLlmFallback", () => {
  it("parses structured JSON from a one-shot engine turn", async () => {
    const questions = {
      route: {
        type: "choice" as const,
        instructions: "pick",
        criteria: { a: "A", b: "B" },
      },
      urgent: { type: "noul" as const, instructions: "urgent?" },
    };

    const json = JSON.stringify({
      answers: {
        route: { type: "choice", choice: "a", confidence: 0.88, probabilities: { a: 0.88 } },
        urgent: { type: "noul", noul: 0.15 },
      },
    });

    const driver = new FakeEngineDriver({ replies: [json] });
    const fallback = new EngineLlmFallback({ driver });
    const req: DecideRequest = {
      purpose: "triage",
      state: { message: "status?" },
      questions,
    };

    const answers = await fallback.answer(req);
    expect(answers?.route).toMatchObject({ type: "choice", choice: "a", confidence: 0.88 });
    expect(answers?.urgent).toMatchObject({ type: "noul", noul: 0.15 });
    await driver.dispose();
  });

  it("returns null when the engine emits invalid JSON", async () => {
    const driver = new FakeEngineDriver({ replies: ["not json"] });
    const fallback = new EngineLlmFallback({ driver });
    const answers = await fallback.answer({
      purpose: "route",
      state: "x",
      questions: {
        route: { type: "choice", instructions: "?", criteria: { a: "A" } },
      },
    });
    expect(answers).toBeNull();
    await driver.dispose();
  });

  it("buildStructuredPrompt includes state and schema", () => {
    const prompt = buildStructuredPrompt({
      purpose: "delegate",
      state: { task: "research" },
      questions: {
        route: { type: "choice", instructions: "?", criteria: { cos_itself: "CoS" } },
      },
    });
    expect(prompt).toContain("delegate");
    expect(prompt).toContain("research");
    expect(prompt).toContain("answers");
  });

  it("parseStructuredAnswers rejects unknown choice keys", () => {
    const parsed = parseStructuredAnswers(
      JSON.stringify({ answers: { route: { type: "choice", choice: "missing", confidence: 1 } } }),
      { route: { type: "choice", instructions: "?", criteria: { a: "A" } } },
    );
    expect(parsed).toBeNull();
  });

  it("runOneShotTurn collects text_delta chunks via EngineDriver", async () => {
    const driver = new FakeEngineDriver({ replies: ['{"answers":{}}'] });
    const text = await runOneShotTurn(
      driver,
      {
        id: "bot_1",
        slug: "t",
        name: "T",
        description: "d",
        pinned: false,
        hidden: false,
        isChiefOfStaff: false,
        createdBy: "user",
        routing: { mode: "auto" },
        permissionPreset: "read_only",
        computer: "none",
        connectors: [],
        limits: {},
      },
      "prompt",
      { model: "fake-default", timeoutMs: 5000 },
    );
    expect(text).toContain("answers");
    await driver.dispose();
  });
});
