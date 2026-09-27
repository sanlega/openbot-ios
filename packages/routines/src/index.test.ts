import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTINE_LIMITS, O7_GUARDRAILS } from "./index.js";

describe("@openbot/routines", () => {
  it("exports O7 defaults", () => {
    expect(DEFAULT_ROUTINE_LIMITS.perRun.usd).toBe(0.5);
    expect(O7_GUARDRAILS.maxRoutinesPerBot).toBe(10);
  });
});
