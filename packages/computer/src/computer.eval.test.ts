import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDecisionService } from "@openbot/decisions";
import { buildComputerQuestions } from "@openbot/decisions";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "../../decisions/fixtures/jev/computer-action");

const live = process.env.JEV_API_KEY ? describe : describe.skip;

live("computer-action Jev eval (opt-in nightly)", () => {
  it("pick-op-and-target fixture stays within latency budget", async () => {
    const request = JSON.parse(
      readFileSync(join(fixtureDir, "pick-op-and-target.request.json"), "utf8"),
    ) as { state: Record<string, unknown> };

    const service = createDecisionService({ apiKey: process.env.JEV_API_KEY! });
    const indices =
      (request.state.observed_elements as Array<{ index: number }> | undefined)?.map((el) =>
        String(el.index),
      ) ?? [];

    const started = Date.now();
    const result = await service.decide({
      purpose: "computer",
      state: request.state,
      questions: buildComputerQuestions(indices),
    });
    const elapsed = Date.now() - started;

    expect(result.provider).toBe("jev");
    expect(result.answers.op?.type).toBe("choice");
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("computer eval (offline)", () => {
  it("buildComputerQuestions includes every observed index", () => {
    const questions = buildComputerQuestions(["0", "1", "2"]);
    const criteria = questions.target_index?.criteria;
    expect(criteria).toBeDefined();
    if (typeof criteria === "object" && !Array.isArray(criteria)) {
      expect(Object.keys(criteria)).toEqual(expect.arrayContaining(["0", "1", "2", "none"]));
    }
  });
});
