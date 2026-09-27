import { describe, expect, it } from "vitest";
import type { JevAnswer } from "@openbot/contracts";
import { evaluateNotifyRule } from "../notify-gate.js";

interface NotifyEvalCase {
  id: string;
  label: string;
  answers: Record<string, JevAnswer>;
  expectDeliver: boolean;
  expectPush?: boolean;
}

function noul(value: number): JevAnswer {
  return { type: "noul", noul: value };
}

/** ~60 labeled notify gate eval cases (plan WS8). Reports scores; does not gate CI. */
const NOTIFY_EVAL_CASES: NotifyEvalCase[] = [
  // Results (deliver)
  {
    id: "n01",
    label: "finished task result",
    answers: {
      is_final_result: noul(0.95),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.05),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: true,
  },
  {
    id: "n02",
    label: "completed report",
    answers: {
      is_final_result: noul(0.85),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: true,
  },
  {
    id: "n03",
    label: "research summary ready",
    answers: {
      is_final_result: noul(0.9),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.08),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: true,
  },

  // Decisions (deliver)
  {
    id: "n04",
    label: "needs user choice",
    answers: {
      is_final_result: noul(0.1),
      needs_user_decision: noul(0.9),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.05),
      is_time_sensitive: noul(0.3),
    },
    expectDeliver: true,
  },
  {
    id: "n05",
    label: "pick between options",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.85),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.2),
    },
    expectDeliver: true,
  },

  // Blockers (deliver)
  {
    id: "n06",
    label: "login required",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.92),
      is_duplicate_or_noise: noul(0.05),
      is_time_sensitive: noul(0.5),
    },
    expectDeliver: true,
  },
  {
    id: "n07",
    label: "CAPTCHA blocker",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.88),
      is_duplicate_or_noise: noul(0.08),
      is_time_sensitive: noul(0.6),
    },
    expectDeliver: true,
  },
  {
    id: "n08",
    label: "payment needed",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.9),
      is_duplicate_or_noise: noul(0.05),
      is_time_sensitive: noul(0.85),
    },
    expectDeliver: true,
    expectPush: true,
  },

  // Chatter (hold)
  {
    id: "n09",
    label: "progress update",
    answers: {
      is_final_result: noul(0.1),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.9),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: false,
  },
  {
    id: "n10",
    label: "starting now",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.85),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: false,
  },
  {
    id: "n11",
    label: "still working",
    answers: {
      is_final_result: noul(0.08),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.88),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: false,
  },
  {
    id: "n12",
    label: "acknowledgement",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.92),
      is_time_sensitive: noul(0.02),
    },
    expectDeliver: false,
  },
  {
    id: "n13",
    label: "plan message",
    answers: {
      is_final_result: noul(0.1),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.8),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: false,
  },

  // Duplicates (hold via noise)
  {
    id: "n14",
    label: "repeats recent result",
    answers: {
      is_final_result: noul(0.7),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.85),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: false,
  },
  {
    id: "n15",
    label: "same topic again",
    answers: {
      is_final_result: noul(0.6),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.75),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: false,
  },

  // Time-sensitive push
  {
    id: "n16",
    label: "deadline approaching",
    answers: {
      is_final_result: noul(0.8),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.9),
    },
    expectDeliver: true,
    expectPush: true,
  },
  {
    id: "n17",
    label: "expiring session",
    answers: {
      is_final_result: noul(0.1),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.85),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.88),
    },
    expectDeliver: true,
    expectPush: true,
  },
  {
    id: "n18",
    label: "non-urgent result no push",
    answers: {
      is_final_result: noul(0.9),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.05),
      is_time_sensitive: noul(0.2),
    },
    expectDeliver: true,
    expectPush: false,
  },

  // Borderline cases
  {
    id: "n19",
    label: "deliver score at threshold",
    answers: {
      is_final_result: noul(0.71),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.2),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: true,
  },
  {
    id: "n20",
    label: "deliver score below threshold",
    answers: {
      is_final_result: noul(0.65),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.2),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: false,
  },
  {
    id: "n21",
    label: "noise at threshold deny",
    answers: {
      is_final_result: noul(0.8),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.31),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: false,
  },
  {
    id: "n22",
    label: "noise just under threshold",
    answers: {
      is_final_result: noul(0.8),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.29),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: true,
  },

  // More chatter variants
  {
    id: "n23",
    label: "halfway done",
    answers: {
      is_final_result: noul(0.15),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.82),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: false,
  },
  {
    id: "n24",
    label: "investigating",
    answers: {
      is_final_result: noul(0.1),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.78),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: false,
  },
  {
    id: "n25",
    label: "will update soon",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.86),
      is_time_sensitive: noul(0.03),
    },
    expectDeliver: false,
  },

  // More results
  {
    id: "n26",
    label: "file ready",
    answers: {
      is_final_result: noul(0.88),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.15),
    },
    expectDeliver: true,
  },
  {
    id: "n27",
    label: "analysis complete",
    answers: {
      is_final_result: noul(0.92),
      needs_user_decision: noul(0.03),
      is_blocker: noul(0.03),
      is_duplicate_or_noise: noul(0.08),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: true,
  },
  {
    id: "n28",
    label: "email sent confirmation",
    answers: {
      is_final_result: noul(0.87),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.12),
      is_time_sensitive: noul(0.2),
    },
    expectDeliver: true,
  },

  // More decisions
  {
    id: "n29",
    label: "approve vendor",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.88),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.08),
      is_time_sensitive: noul(0.4),
    },
    expectDeliver: true,
  },
  {
    id: "n30",
    label: "choose meeting time",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.82),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.3),
    },
    expectDeliver: true,
  },

  // More blockers
  {
    id: "n31",
    label: "missing access",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.91),
      is_duplicate_or_noise: noul(0.08),
      is_time_sensitive: noul(0.5),
    },
    expectDeliver: true,
  },
  {
    id: "n32",
    label: "contradictory instructions",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.15),
      is_blocker: noul(0.87),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.4),
    },
    expectDeliver: true,
  },
  {
    id: "n33",
    label: "2FA required",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.93),
      is_duplicate_or_noise: noul(0.05),
      is_time_sensitive: noul(0.75),
    },
    expectDeliver: true,
  },

  // Uncertain middle (hold)
  {
    id: "n34",
    label: "uncertain result",
    answers: {
      is_final_result: noul(0.55),
      needs_user_decision: noul(0.3),
      is_blocker: noul(0.2),
      is_duplicate_or_noise: noul(0.4),
      is_time_sensitive: noul(0.2),
    },
    expectDeliver: false,
  },
  {
    id: "n35",
    label: "maybe a result",
    answers: {
      is_final_result: noul(0.6),
      needs_user_decision: noul(0.4),
      is_blocker: noul(0.2),
      is_duplicate_or_noise: noul(0.35),
      is_time_sensitive: noul(0.15),
    },
    expectDeliver: false,
  },

  // Additional cases to reach ~60
  {
    id: "n36",
    label: "bot already told user",
    answers: {
      is_final_result: noul(0.5),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.7),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: false,
  },
  {
    id: "n37",
    label: "cos relay unnecessary",
    answers: {
      is_final_result: noul(0.4),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.65),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: false,
  },
  {
    id: "n38",
    label: "routine completed",
    answers: {
      is_final_result: noul(0.88),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: true,
  },
  {
    id: "n39",
    label: "dry run report",
    answers: {
      is_final_result: noul(0.75),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.15),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: true,
  },
  {
    id: "n40",
    label: "spend cap hit blocker",
    answers: {
      is_final_result: noul(0.1),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.9),
      is_duplicate_or_noise: noul(0.05),
      is_time_sensitive: noul(0.6),
    },
    expectDeliver: true,
  },
  {
    id: "n41",
    label: "gentle reminder not urgent",
    answers: {
      is_final_result: noul(0.3),
      needs_user_decision: noul(0.5),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.4),
      is_time_sensitive: noul(0.2),
    },
    expectDeliver: false,
  },
  {
    id: "n42",
    label: "FYI update",
    answers: {
      is_final_result: noul(0.2),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.7),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: false,
  },
  {
    id: "n43",
    label: "checking in",
    answers: {
      is_final_result: noul(0.1),
      needs_user_decision: noul(0.2),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.8),
      is_time_sensitive: noul(0.05),
    },
    expectDeliver: false,
  },
  {
    id: "n44",
    label: "queued for processing",
    answers: {
      is_final_result: noul(0.08),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.83),
      is_time_sensitive: noul(0.03),
    },
    expectDeliver: false,
  },
  {
    id: "n45",
    label: "waiting on API",
    answers: {
      is_final_result: noul(0.1),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.15),
      is_duplicate_or_noise: noul(0.75),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: false,
  },
  {
    id: "n46",
    label: "strong decision needed",
    answers: {
      is_final_result: noul(0.1),
      needs_user_decision: noul(0.92),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.08),
      is_time_sensitive: noul(0.7),
    },
    expectDeliver: true,
    expectPush: true,
  },
  {
    id: "n47",
    label: "urgent blocker push",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.95),
      is_duplicate_or_noise: noul(0.05),
      is_time_sensitive: noul(0.92),
    },
    expectDeliver: true,
    expectPush: true,
  },
  {
    id: "n48",
    label: "time sensitive result",
    answers: {
      is_final_result: noul(0.85),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.8),
    },
    expectDeliver: true,
    expectPush: true,
  },
  {
    id: "n49",
    label: "borderline push no",
    answers: {
      is_final_result: noul(0.8),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.15),
      is_time_sensitive: noul(0.65),
    },
    expectDeliver: true,
    expectPush: false,
  },
  {
    id: "n50",
    label: "borderline push yes",
    answers: {
      is_final_result: noul(0.8),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.15),
      is_time_sensitive: noul(0.75),
    },
    expectDeliver: true,
    expectPush: true,
  },
  {
    id: "n51",
    label: "combined update result",
    answers: {
      is_final_result: noul(0.82),
      needs_user_decision: noul(0.2),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.12),
      is_time_sensitive: noul(0.15),
    },
    expectDeliver: true,
  },
  {
    id: "n52",
    label: "low confidence all",
    answers: {
      is_final_result: noul(0.4),
      needs_user_decision: noul(0.4),
      is_blocker: noul(0.4),
      is_duplicate_or_noise: noul(0.4),
      is_time_sensitive: noul(0.4),
    },
    expectDeliver: false,
  },
  {
    id: "n53",
    label: "high noise low signal",
    answers: {
      is_final_result: noul(0.3),
      needs_user_decision: noul(0.2),
      is_blocker: noul(0.2),
      is_duplicate_or_noise: noul(0.95),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: false,
  },
  {
    id: "n54",
    label: "blocker not time sensitive",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.88),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.3),
    },
    expectDeliver: true,
    expectPush: false,
  },
  {
    id: "n55",
    label: "decision with deadline",
    answers: {
      is_final_result: noul(0.1),
      needs_user_decision: noul(0.85),
      is_blocker: noul(0.1),
      is_duplicate_or_noise: noul(0.1),
      is_time_sensitive: noul(0.82),
    },
    expectDeliver: true,
    expectPush: true,
  },
  {
    id: "n56",
    label: "result user asked for",
    answers: {
      is_final_result: noul(0.9),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.2),
      is_time_sensitive: noul(0.15),
    },
    expectDeliver: true,
  },
  {
    id: "n57",
    label: "empty progress",
    answers: {
      is_final_result: noul(0.02),
      needs_user_decision: noul(0.02),
      is_blocker: noul(0.02),
      is_duplicate_or_noise: noul(0.9),
      is_time_sensitive: noul(0.02),
    },
    expectDeliver: false,
  },
  {
    id: "n58",
    label: "thinking aloud",
    answers: {
      is_final_result: noul(0.05),
      needs_user_decision: noul(0.05),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.87),
      is_time_sensitive: noul(0.03),
    },
    expectDeliver: false,
  },
  {
    id: "n59",
    label: "milestone reached",
    answers: {
      is_final_result: noul(0.78),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.15),
      is_time_sensitive: noul(0.2),
    },
    expectDeliver: true,
  },
  {
    id: "n60",
    label: "partial result not final",
    answers: {
      is_final_result: noul(0.45),
      needs_user_decision: noul(0.1),
      is_blocker: noul(0.05),
      is_duplicate_or_noise: noul(0.55),
      is_time_sensitive: noul(0.1),
    },
    expectDeliver: false,
  },
];

describe("notify gate eval set", () => {
  const results: Array<{ id: string; label: string; pass: boolean }> = [];

  for (const case_ of NOTIFY_EVAL_CASES) {
    it(`${case_.id}: ${case_.label}`, () => {
      const { deliver, push } = evaluateNotifyRule(case_.answers);
      const pass =
        deliver === case_.expectDeliver &&
        (case_.expectPush === undefined || push === case_.expectPush);
      results.push({ id: case_.id, label: case_.label, pass });
      expect(deliver).toBe(case_.expectDeliver);
      if (case_.expectPush !== undefined) {
        expect(push).toBe(case_.expectPush);
      }
    });
  }

  it("reports eval score", () => {
    const passed = results.filter((r) => r.pass).length;
    const total = NOTIFY_EVAL_CASES.length;
    const score = (passed / total) * 100;
    console.log(`Notify gate eval: ${passed}/${total} (${score.toFixed(1)}%)`);
    expect(total).toBeGreaterThanOrEqual(60);
  });
});
