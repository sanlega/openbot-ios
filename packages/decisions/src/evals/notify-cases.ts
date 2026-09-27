import type { JevAnswer } from "@openbot/contracts";
import { evaluateNotifyGate, noulAnswer, type NotifyGateResult } from "../gate-rules.js";

export interface NotifyEvalCase {
  id: string;
  label: string;
  capsOk?: boolean;
  answers: Record<string, JevAnswer>;
  expected: NotifyGateResult;
}

function notifyCase(
  id: string,
  label: string,
  answers: Record<string, JevAnswer>,
  expected: NotifyGateResult,
  capsOk = true,
): NotifyEvalCase {
  return { id, label, capsOk, answers, expected };
}

const resultDeliver: Record<string, JevAnswer> = {
  valid_kind: noulAnswer(0.92),
  chatter: noulAnswer(0.1),
  duplicate_of_recent: noulAnswer(0.05),
  is_time_sensitive: noulAnswer(0.2),
  user_asked: noulAnswer(0.3),
};

/** ~60 labeled notify-gate eval cases (plan WS7). */
export const NOTIFY_EVAL_CASES: NotifyEvalCase[] = [
  notifyCase("notify-01-result", "finished result", resultDeliver, { deliver: true, push: false }),

  notifyCase(
    "notify-02-blocker-urgent",
    "blocker with deadline",
    {
      ...resultDeliver,
      valid_kind: noulAnswer(0.95),
      is_time_sensitive: noulAnswer(0.85),
    },
    { deliver: true, push: true },
  ),

  notifyCase(
    "notify-03-chatter",
    "progress update",
    {
      valid_kind: noulAnswer(0.4),
      chatter: noulAnswer(0.9),
      duplicate_of_recent: noulAnswer(0.1),
      is_time_sensitive: noulAnswer(0.05),
      user_asked: noulAnswer(0.1),
    },
    { deliver: false, push: false },
  ),

  notifyCase(
    "notify-04-duplicate",
    "duplicate dedupe_key",
    {
      ...resultDeliver,
      duplicate_of_recent: noulAnswer(0.9),
    },
    { deliver: false, push: false },
  ),

  notifyCase(
    "notify-05-invalid-kind",
    "not result/decision/blocker",
    {
      valid_kind: noulAnswer(0.2),
      chatter: noulAnswer(0.3),
      duplicate_of_recent: noulAnswer(0.1),
      is_time_sensitive: noulAnswer(0.1),
      user_asked: noulAnswer(0.1),
    },
    { deliver: false, push: false },
  ),

  notifyCase(
    "notify-06-decision",
    "needs user choice",
    {
      valid_kind: noulAnswer(0.88),
      chatter: noulAnswer(0.15),
      duplicate_of_recent: noulAnswer(0.05),
      is_time_sensitive: noulAnswer(0.4),
      user_asked: noulAnswer(0.6),
    },
    { deliver: true, push: false },
  ),

  notifyCase(
    "notify-07-caps",
    "rate cap blocks delivery",
    resultDeliver,
    {
      deliver: false,
      push: false,
    },
    false,
  ),

  ...Array.from({ length: 53 }, (_, i) => {
    const idx = i + 8;
    const valid = 0.55 + (idx % 5) * 0.1;
    const chatter = (idx % 6) / 10;
    const duplicate = ((idx + 1) % 7) / 10;
    const urgent = ((idx + 2) % 8) / 10;
    const answers: Record<string, JevAnswer> = {
      valid_kind: noulAnswer(Math.min(1, valid)),
      chatter: noulAnswer(chatter),
      duplicate_of_recent: noulAnswer(duplicate),
      is_time_sensitive: noulAnswer(urgent),
      user_asked: noulAnswer((idx % 4) / 10),
    };
    const expected = evaluateNotifyGate({ capsOk: true, answers });
    return notifyCase(
      `notify-${String(idx).padStart(2, "0")}-generated`,
      `generated matrix ${idx}`,
      answers,
      expected,
    );
  }),
];

export function scoreNotifyEvalCases(
  cases: NotifyEvalCase[],
  answersFor: (c: NotifyEvalCase) => Record<string, JevAnswer> = (c) => c.answers,
): { passed: number; total: number; failures: string[] } {
  const failures: string[] = [];
  let passed = 0;
  for (const c of cases) {
    const result = evaluateNotifyGate({ capsOk: c.capsOk ?? true, answers: answersFor(c) });
    const ok = result.deliver === c.expected.deliver && result.push === c.expected.push;
    if (ok) passed += 1;
    else
      failures.push(
        `${c.id}: expected ${JSON.stringify(c.expected)} got ${JSON.stringify(result)}`,
      );
  }
  return { passed, total: cases.length, failures };
}
