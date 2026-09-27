import type { JevAnswer } from "@openbot/contracts";
import {
  choiceAnswer,
  evaluateSpawnGate,
  noulAnswer,
  type SpawnGateResult,
} from "../gate-rules.js";

export interface SpawnEvalCase {
  id: string;
  label: string;
  capsOk?: boolean;
  answers: Record<string, JevAnswer>;
  expected: SpawnGateResult;
}

function spawnCase(
  id: string,
  label: string,
  answers: Record<string, JevAnswer>,
  expected: SpawnGateResult,
  capsOk = true,
): SpawnEvalCase {
  return { id, label, capsOk, answers, expected };
}

const baseDenyNewBot: Record<string, JevAnswer> = {
  route: choiceAnswer("new_bot", 0.85),
  user_requested: noulAnswer(0.1),
  existing_can_do: noulAnswer(0.8),
  one_off: noulAnswer(0.2),
  recurring_ownership: noulAnswer(0.8),
  distinct_boundary: noulAnswer(0.8),
  duplicates_existing: noulAnswer(0.1),
};

/** ~40 labeled spawn-gate eval cases (plan WS7). */
export const SPAWN_EVAL_CASES: SpawnEvalCase[] = [
  spawnCase(
    "spawn-01-user-requested",
    "user explicitly requested a bot",
    {
      ...baseDenyNewBot,
      user_requested: noulAnswer(0.95),
    },
    { allow: true, suggestion: null },
  ),

  spawnCase(
    "spawn-02-valid-recurring",
    "recurring duty with clear boundary",
    {
      ...baseDenyNewBot,
      existing_can_do: noulAnswer(0.1),
      one_off: noulAnswer(0.2),
    },
    { allow: true, suggestion: null },
  ),

  spawnCase(
    "spawn-03-valid-boundary",
    "distinct boundary without recurring flag",
    {
      ...baseDenyNewBot,
      existing_can_do: noulAnswer(0.1),
      one_off: noulAnswer(0.2),
      recurring_ownership: noulAnswer(0.2),
      distinct_boundary: noulAnswer(0.9),
    },
    { allow: true, suggestion: null },
  ),

  spawnCase(
    "spawn-04-one-off",
    "one-off task should not spawn",
    {
      ...baseDenyNewBot,
      one_off: noulAnswer(0.9),
    },
    { allow: false, suggestion: "cos_itself" },
  ),

  spawnCase(
    "spawn-05-existing-can-do",
    "existing bot can handle it",
    {
      ...baseDenyNewBot,
      existing_can_do: noulAnswer(0.9),
    },
    { allow: false, suggestion: "cos_itself" },
  ),

  spawnCase(
    "spawn-06-duplicate-responsibility",
    "overlaps existing bot",
    {
      ...baseDenyNewBot,
      duplicates_existing: noulAnswer(0.85),
    },
    { allow: false, suggestion: "cos_itself" },
  ),

  spawnCase(
    "spawn-07-low-confidence",
    "new_bot choice but low confidence",
    {
      ...baseDenyNewBot,
      route: choiceAnswer("new_bot", 0.55),
    },
    { allow: false, suggestion: "cos_itself" },
  ),

  spawnCase(
    "spawn-08-delegate-research",
    "route to existing bot",
    {
      route: choiceAnswer("research-bot", 0.92),
      user_requested: noulAnswer(0.1),
      existing_can_do: noulAnswer(0.9),
      one_off: noulAnswer(0.3),
      recurring_ownership: noulAnswer(0.2),
      distinct_boundary: noulAnswer(0.1),
      duplicates_existing: noulAnswer(0.1),
    },
    { allow: false, suggestion: "research-bot" },
  ),

  spawnCase(
    "spawn-09-cos-itself",
    "CoS should handle in session",
    {
      route: choiceAnswer("cos_itself", 0.88),
      user_requested: noulAnswer(0.05),
      existing_can_do: noulAnswer(0.7),
      one_off: noulAnswer(0.6),
      recurring_ownership: noulAnswer(0.1),
      distinct_boundary: noulAnswer(0.1),
      duplicates_existing: noulAnswer(0.05),
    },
    { allow: false, suggestion: "cos_itself" },
  ),

  spawnCase(
    "spawn-10-caps-blocked",
    "hard caps refuse regardless of Jev",
    baseDenyNewBot,
    {
      allow: false,
      suggestion: "cos_itself",
    },
    false,
  ),

  ...Array.from({ length: 30 }, (_, i) => {
    const idx = i + 11;
    const oneOff = (idx % 5) / 10;
    const existing = ((idx + 2) % 5) / 10;
    const recurring = idx % 2 === 0 ? 0.85 : 0.25;
    const boundary = idx % 3 === 0 ? 0.9 : 0.2;
    const confidence = 0.65 + (idx % 4) * 0.08;
    const answers: Record<string, JevAnswer> = {
      route: choiceAnswer("new_bot", confidence),
      user_requested: noulAnswer(idx % 7 === 0 ? 0.85 : 0.15),
      existing_can_do: noulAnswer(existing),
      one_off: noulAnswer(oneOff),
      recurring_ownership: noulAnswer(recurring),
      distinct_boundary: noulAnswer(boundary),
      duplicates_existing: noulAnswer((idx % 6) / 10),
    };
    const expected = evaluateSpawnGate({ capsOk: true, answers });
    return spawnCase(
      `spawn-${String(idx).padStart(2, "0")}-generated`,
      `generated matrix ${idx}`,
      answers,
      expected,
    );
  }),
];

export function scoreSpawnEvalCases(
  cases: SpawnEvalCase[],
  answersFor: (c: SpawnEvalCase) => Record<string, JevAnswer> = (c) => c.answers,
): { passed: number; total: number; failures: string[] } {
  const failures: string[] = [];
  let passed = 0;
  for (const c of cases) {
    const result = evaluateSpawnGate({ capsOk: c.capsOk ?? true, answers: answersFor(c) });
    const ok = result.allow === c.expected.allow && result.suggestion === c.expected.suggestion;
    if (ok) passed += 1;
    else
      failures.push(
        `${c.id}: expected ${JSON.stringify(c.expected)} got ${JSON.stringify(result)}`,
      );
  }
  return { passed, total: cases.length, failures };
}
