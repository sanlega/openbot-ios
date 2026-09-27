import { describe, expect, it } from "vitest";
import { NOTIFY_EVAL_CASES, scoreNotifyEvalCases } from "./notify-cases.js";

describe("notify gate labeled eval set", () => {
  it("has about 60 labeled cases", () => {
    expect(NOTIFY_EVAL_CASES.length).toBeGreaterThanOrEqual(60);
  });

  it("gate rule matches every labeled expected outcome", () => {
    const score = scoreNotifyEvalCases(NOTIFY_EVAL_CASES);
    expect(score.failures, score.failures.join("\n")).toEqual([]);
    expect(score.passed).toBe(score.total);
  });
});
