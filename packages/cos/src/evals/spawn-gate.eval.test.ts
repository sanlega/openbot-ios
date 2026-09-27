import { describe, expect, it } from "vitest";
import type { JevAnswer } from "@openbot/contracts";
import { evaluateSpawnRule } from "../spawn-gate.js";

interface SpawnEvalCase {
  id: string;
  label: string;
  answers: Record<string, JevAnswer>;
  expectAllow: boolean;
}

function noul(value: number): JevAnswer {
  return { type: "noul", noul: value };
}

function choice(choiceVal: string, confidence: number): JevAnswer {
  return { type: "choice", choice: choiceVal, confidence, probabilities: {} };
}

/** ~40 labeled spawn gate eval cases (plan WS8). Reports scores; does not gate CI. */
const SPAWN_EVAL_CASES: SpawnEvalCase[] = [
  // User-requested (should allow)
  { id: "s01", label: "explicit user request", answers: { route: choice("new_bot", 0.5), user_requested: noul(0.95), existing_can_do: noul(0.5), one_off: noul(0.5), recurring_ownership: noul(0.5), distinct_boundary: noul(0.5), duplicates_existing: noul(0.5) }, expectAllow: true },
  { id: "s02", label: "user asked for dedicated bot", answers: { route: choice("new_bot", 0.6), user_requested: noul(0.85), existing_can_do: noul(0.7), one_off: noul(0.6), recurring_ownership: noul(0.3), distinct_boundary: noul(0.3), duplicates_existing: noul(0.5) }, expectAllow: true },

  // One-off tasks (should deny)
  { id: "s03", label: "one-off research task", answers: { route: choice("new_bot", 0.9), user_requested: noul(0.1), existing_can_do: noul(0.2), one_off: noul(0.95), recurring_ownership: noul(0.1), distinct_boundary: noul(0.3), duplicates_existing: noul(0.1) }, expectAllow: false },
  { id: "s04", label: "single email reply", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.3), one_off: noul(0.85), recurring_ownership: noul(0.05), distinct_boundary: noul(0.2), duplicates_existing: noul(0.1) }, expectAllow: false },
  { id: "s05", label: "quick summary request", answers: { route: choice("new_bot", 0.75), user_requested: noul(0.05), existing_can_do: noul(0.4), one_off: noul(0.9), recurring_ownership: noul(0.1), distinct_boundary: noul(0.1), duplicates_existing: noul(0.2) }, expectAllow: false },

  // Existing bot can do it (should deny)
  { id: "s06", label: "inbox bot can handle", answers: { route: choice("inbox-bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.9), one_off: noul(0.2), recurring_ownership: noul(0.5), distinct_boundary: noul(0.1), duplicates_existing: noul(0.1) }, expectAllow: false },
  { id: "s07", label: "research bot overlap", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.85), one_off: noul(0.2), recurring_ownership: noul(0.7), distinct_boundary: noul(0.3), duplicates_existing: noul(0.1) }, expectAllow: false },

  // Recurring with distinct boundary (should allow)
  { id: "s08", label: "recurring gmail duty", answers: { route: choice("new_bot", 0.85), user_requested: noul(0.1), existing_can_do: noul(0.15), one_off: noul(0.1), recurring_ownership: noul(0.85), distinct_boundary: noul(0.2), duplicates_existing: noul(0.1) }, expectAllow: true },
  { id: "s09", label: "distinct codex engine needed", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.2), one_off: noul(0.15), recurring_ownership: noul(0.3), distinct_boundary: noul(0.9), duplicates_existing: noul(0.1) }, expectAllow: true },
  { id: "s10", label: "parallel work on busy bot", answers: { route: choice("new_bot", 0.75), user_requested: noul(0.1), existing_can_do: noul(0.25), one_off: noul(0.2), recurring_ownership: noul(0.1), distinct_boundary: noul(0.8), duplicates_existing: noul(0.15) }, expectAllow: true },

  // Duplicates (should deny)
  { id: "s11", label: "duplicates research bot", answers: { route: choice("new_bot", 0.85), user_requested: noul(0.1), existing_can_do: noul(0.2), one_off: noul(0.1), recurring_ownership: noul(0.8), distinct_boundary: noul(0.3), duplicates_existing: noul(0.85) }, expectAllow: false },
  { id: "s12", label: "overlapping responsibility", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.3), one_off: noul(0.2), recurring_ownership: noul(0.75), distinct_boundary: noul(0.4), duplicates_existing: noul(0.7) }, expectAllow: false },

  // CoS should do it (should deny)
  { id: "s13", label: "cos can handle in session", answers: { route: choice("cos_itself", 0.9), user_requested: noul(0.1), existing_can_do: noul(0.1), one_off: noul(0.7), recurring_ownership: noul(0.1), distinct_boundary: noul(0.1), duplicates_existing: noul(0.1) }, expectAllow: false },
  { id: "s14", label: "simple status check", answers: { route: choice("cos_itself", 0.85), user_requested: noul(0.05), existing_can_do: noul(0.1), one_off: noul(0.9), recurring_ownership: noul(0.05), distinct_boundary: noul(0.05), duplicates_existing: noul(0.05) }, expectAllow: false },

  // Uncertain middle band (should deny — conservative)
  { id: "s15", label: "uncertain recurring", answers: { route: choice("new_bot", 0.6), user_requested: noul(0.3), existing_can_do: noul(0.5), one_off: noul(0.5), recurring_ownership: noul(0.55), distinct_boundary: noul(0.55), duplicates_existing: noul(0.4) }, expectAllow: false },
  { id: "s16", label: "low route confidence", answers: { route: choice("new_bot", 0.5), user_requested: noul(0.2), existing_can_do: noul(0.2), one_off: noul(0.2), recurring_ownership: noul(0.8), distinct_boundary: noul(0.3), duplicates_existing: noul(0.1) }, expectAllow: false },

  // More cases to reach ~40
  { id: "s17", label: "organize-only bot", answers: { route: choice("new_bot", 0.7), user_requested: noul(0.1), existing_can_do: noul(0.6), one_off: noul(0.5), recurring_ownership: noul(0.4), distinct_boundary: noul(0.2), duplicates_existing: noul(0.3) }, expectAllow: false },
  { id: "s18", label: "monitor in general", answers: { route: choice("new_bot", 0.75), user_requested: noul(0.05), existing_can_do: noul(0.5), one_off: noul(0.3), recurring_ownership: noul(0.6), distinct_boundary: noul(0.15), duplicates_existing: noul(0.4) }, expectAllow: false },
  { id: "s19", label: "test idea bot", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.4), one_off: noul(0.8), recurring_ownership: noul(0.2), distinct_boundary: noul(0.3), duplicates_existing: noul(0.2) }, expectAllow: false },
  { id: "s20", label: "split task into pieces", answers: { route: choice("new_bot", 0.7), user_requested: noul(0.1), existing_can_do: noul(0.3), one_off: noul(0.75), recurring_ownership: noul(0.15), distinct_boundary: noul(0.2), duplicates_existing: noul(0.1) }, expectAllow: false },
  { id: "s21", label: "long-running project", answers: { route: choice("new_bot", 0.85), user_requested: noul(0.1), existing_can_do: noul(0.15), one_off: noul(0.1), recurring_ownership: noul(0.9), distinct_boundary: noul(0.3), duplicates_existing: noul(0.1) }, expectAllow: true },
  { id: "s22", label: "different gmail account", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.2), one_off: noul(0.15), recurring_ownership: noul(0.4), distinct_boundary: noul(0.85), duplicates_existing: noul(0.1) }, expectAllow: true },
  { id: "s23", label: "delegate to inbox-bot", answers: { route: choice("inbox-bot", 0.9), user_requested: noul(0.1), existing_can_do: noul(0.95), one_off: noul(0.3), recurring_ownership: noul(0.2), distinct_boundary: noul(0.1), duplicates_existing: noul(0.1) }, expectAllow: false },
  { id: "s24", label: "delegate to research-bot", answers: { route: choice("research-bot", 0.85), user_requested: noul(0.1), existing_can_do: noul(0.9), one_off: noul(0.4), recurring_ownership: noul(0.3), distinct_boundary: noul(0.1), duplicates_existing: noul(0.1) }, expectAllow: false },
  { id: "s25", label: "user request borderline", answers: { route: choice("new_bot", 0.5), user_requested: noul(0.79), existing_can_do: noul(0.5), one_off: noul(0.5), recurring_ownership: noul(0.5), distinct_boundary: noul(0.5), duplicates_existing: noul(0.5) }, expectAllow: false },
  { id: "s26", label: "user request at threshold", answers: { route: choice("new_bot", 0.5), user_requested: noul(0.81), existing_can_do: noul(0.5), one_off: noul(0.5), recurring_ownership: noul(0.5), distinct_boundary: noul(0.5), duplicates_existing: noul(0.5) }, expectAllow: true },
  { id: "s27", label: "recurring at threshold", answers: { route: choice("new_bot", 0.75), user_requested: noul(0.1), existing_can_do: noul(0.2), one_off: noul(0.2), recurring_ownership: noul(0.71), distinct_boundary: noul(0.3), duplicates_existing: noul(0.1) }, expectAllow: true },
  { id: "s28", label: "boundary at threshold", answers: { route: choice("new_bot", 0.75), user_requested: noul(0.1), existing_can_do: noul(0.2), one_off: noul(0.2), recurring_ownership: noul(0.3), distinct_boundary: noul(0.71), duplicates_existing: noul(0.1) }, expectAllow: true },
  { id: "s29", label: "one_off at threshold deny", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.2), one_off: noul(0.41), recurring_ownership: noul(0.8), distinct_boundary: noul(0.3), duplicates_existing: noul(0.1) }, expectAllow: false },
  { id: "s30", label: "one_off just under threshold", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.2), one_off: noul(0.39), recurring_ownership: noul(0.8), distinct_boundary: noul(0.3), duplicates_existing: noul(0.1) }, expectAllow: true },
  { id: "s31", label: "existing_can_do at threshold deny", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.31), one_off: noul(0.2), recurring_ownership: noul(0.8), distinct_boundary: noul(0.3), duplicates_existing: noul(0.1) }, expectAllow: false },
  { id: "s32", label: "duplicates at threshold deny", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.2), one_off: noul(0.2), recurring_ownership: noul(0.8), distinct_boundary: noul(0.3), duplicates_existing: noul(0.31) }, expectAllow: false },
  { id: "s33", label: "route confidence below threshold", answers: { route: choice("new_bot", 0.65), user_requested: noul(0.1), existing_can_do: noul(0.2), one_off: noul(0.2), recurring_ownership: noul(0.8), distinct_boundary: noul(0.3), duplicates_existing: noul(0.1) }, expectAllow: false },
  { id: "s34", label: "route confidence at threshold", answers: { route: choice("new_bot", 0.71), user_requested: noul(0.1), existing_can_do: noul(0.2), one_off: noul(0.2), recurring_ownership: noul(0.8), distinct_boundary: noul(0.3), duplicates_existing: noul(0.1) }, expectAllow: true },
  { id: "s35", label: "weekly report duty", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.15), one_off: noul(0.1), recurring_ownership: noul(0.88), distinct_boundary: noul(0.2), duplicates_existing: noul(0.1) }, expectAllow: true },
  { id: "s36", label: "social media monitoring", answers: { route: choice("new_bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.25), one_off: noul(0.15), recurring_ownership: noul(0.82), distinct_boundary: noul(0.4), duplicates_existing: noul(0.15) }, expectAllow: true },
  { id: "s37", label: "rephrase same request", answers: { route: choice("new_bot", 0.7), user_requested: noul(0.15), existing_can_do: noul(0.55), one_off: noul(0.6), recurring_ownership: noul(0.4), distinct_boundary: noul(0.3), duplicates_existing: noul(0.4) }, expectAllow: false },
  { id: "s38", label: "stretch existing bot scope", answers: { route: choice("inbox-bot", 0.8), user_requested: noul(0.1), existing_can_do: noul(0.75), one_off: noul(0.3), recurring_ownership: noul(0.5), distinct_boundary: noul(0.2), duplicates_existing: noul(0.2) }, expectAllow: false },
  { id: "s39", label: "project with clear boundary", answers: { route: choice("new_bot", 0.82), user_requested: noul(0.1), existing_can_do: noul(0.18), one_off: noul(0.15), recurring_ownership: noul(0.75), distinct_boundary: noul(0.6), duplicates_existing: noul(0.12) }, expectAllow: true },
  { id: "s40", label: "user request overrides one-off", answers: { route: choice("new_bot", 0.5), user_requested: noul(0.9), existing_can_do: noul(0.5), one_off: noul(0.95), recurring_ownership: noul(0.1), distinct_boundary: noul(0.1), duplicates_existing: noul(0.5) }, expectAllow: true },
];

describe("spawn gate eval set", () => {
  const results: Array<{ id: string; label: string; pass: boolean }> = [];

  for (const case_ of SPAWN_EVAL_CASES) {
    it(`${case_.id}: ${case_.label}`, () => {
      const { allow } = evaluateSpawnRule(case_.answers);
      const pass = allow === case_.expectAllow;
      results.push({ id: case_.id, label: case_.label, pass });
      expect(allow).toBe(case_.expectAllow);
    });
  }

  it("reports eval score", () => {
    const passed = results.filter((r) => r.pass).length;
    const total = SPAWN_EVAL_CASES.length;
    const score = (passed / total) * 100;
    console.log(`Spawn gate eval: ${passed}/${total} (${score.toFixed(1)}%)`);
    expect(total).toBeGreaterThanOrEqual(40);
  });
});
