import { describe, expect, it } from "vitest";
import { SPAWN_EVAL_CASES, scoreSpawnEvalCases } from "./spawn-cases.js";

describe("spawn gate labeled eval set", () => {
  it("has about 40 labeled cases", () => {
    expect(SPAWN_EVAL_CASES.length).toBeGreaterThanOrEqual(40);
  });

  it("gate rule matches every labeled expected outcome", () => {
    const score = scoreSpawnEvalCases(SPAWN_EVAL_CASES);
    expect(score.failures, score.failures.join("\n")).toEqual([]);
    expect(score.passed).toBe(score.total);
  });
});
