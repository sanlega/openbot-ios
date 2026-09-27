import { describe, expect, it } from "vitest";
import { createDecisionService } from "../decision-service.js";
import { evaluateNotifyGate } from "../gate-rules.js";
import { buildNotifyQuestions } from "../questions/notify.js";

const live = process.env.JEV_API_KEY ? describe : describe.skip;

interface LiveNotifyCase {
  id: string;
  label: string;
  state: Record<string, unknown>;
  expectedDeliver: boolean;
}

const LIVE_NOTIFY_CASES: LiveNotifyCase[] = [
  {
    id: "live-notify-result",
    label: "deliver finished result",
    state: {
      message: {
        kind: "result",
        body: "Daily digest sent to 42 recipients.",
        dedupe_key: "digest-done",
      },
      recent_delivered: [],
    },
    expectedDeliver: true,
  },
  {
    id: "live-notify-chatter",
    label: "hold progress chatter",
    state: {
      message: {
        kind: "result",
        body: "Starting now, I'll look into that.",
        dedupe_key: "progress-1",
      },
      recent_delivered: [],
    },
    expectedDeliver: false,
  },
  {
    id: "live-notify-blocker",
    label: "deliver payment blocker",
    state: {
      message: {
        kind: "blocker",
        body: "Checkout needs your card — session expires in 10 minutes.",
        dedupe_key: "pay-blocker",
      },
      recent_delivered: [],
    },
    expectedDeliver: true,
  },
  {
    id: "live-notify-duplicate",
    label: "hold duplicate topic",
    state: {
      message: { kind: "result", body: "Digest complete.", dedupe_key: "digest-done" },
      recent_delivered: [{ dedupe_key: "digest-done", body: "Digest complete." }],
    },
    expectedDeliver: false,
  },
  {
    id: "live-notify-decision",
    label: "deliver decision card",
    state: {
      message: {
        kind: "decision",
        body: "Approve deploying v2 to production?",
        options: ["Yes", "No"],
        dedupe_key: "deploy-v2",
      },
      recent_delivered: [],
    },
    expectedDeliver: true,
  },
];

live("notify gate live eval (JEV_API_KEY)", () => {
  it("reports alignment score against labeled scenarios (non-gating)", async () => {
    const service = createDecisionService({ apiKey: process.env.JEV_API_KEY! });
    const questions = buildNotifyQuestions();

    let aligned = 0;
    const mismatches: string[] = [];

    for (const c of LIVE_NOTIFY_CASES) {
      const result = await service.decide({
        purpose: "notify",
        state: c.state,
        questions,
      });
      const gate = evaluateNotifyGate({ capsOk: true, answers: result.answers });
      if (gate.deliver === c.expectedDeliver) aligned += 1;
      else mismatches.push(`${c.id}: expected deliver=${c.expectedDeliver} got ${gate.deliver}`);
    }

    console.info(`notify live eval: ${aligned}/${LIVE_NOTIFY_CASES.length} aligned`);
    if (mismatches.length > 0) console.info(mismatches.join("\n"));
    expect(LIVE_NOTIFY_CASES.length).toBeGreaterThan(0);
  }, 60_000);
});
