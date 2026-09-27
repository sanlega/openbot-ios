import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDecisionService } from "../decision-service.js";
import { evaluateSpawnGate } from "../gate-rules.js";
import { buildSpawnQuestions } from "../questions/spawn.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../fixtures/jev");

const live = process.env.JEV_API_KEY ? describe : describe.skip;

interface LiveSpawnCase {
  id: string;
  label: string;
  state: Record<string, unknown>;
  expectedAllow: boolean;
}

const LIVE_SPAWN_CASES: LiveSpawnCase[] = [
  {
    id: "live-spawn-delegate-research",
    label: "competitor research delegates to research-bot",
    state: JSON.parse(readFileSync(join(fixturesDir, "choice/route.request.json"), "utf8")).state,
    expectedAllow: false,
  },
  {
    id: "live-spawn-recurring-github",
    label: "recurring GitHub monitor from triage batch",
    state: JSON.parse(readFileSync(join(fixturesDir, "batch/triage.request.json"), "utf8")).state,
    expectedAllow: true,
  },
  {
    id: "live-spawn-user-requested",
    label: "user explicitly requested a new bot",
    state: {
      roster: [],
      recent_user_messages: ["Please create a dedicated bot for invoice processing"],
      request: { name: "invoice-bot", lifetime: "recurring", user_requested: true },
      user_requested: true,
    },
    expectedAllow: true,
  },
  {
    id: "live-spawn-one-off",
    label: "one-off status lookup",
    state: {
      roster: [{ id: "inbox-bot", description: "inbox triage" }],
      recent_user_messages: ["What's the status of the daily digest routine?"],
      request: { name: "status", lifetime: "one_off" },
    },
    expectedAllow: false,
  },
];

live("spawn gate live eval (JEV_API_KEY)", () => {
  it("reports alignment score against labeled scenarios (non-gating)", async () => {
    const service = createDecisionService({ apiKey: process.env.JEV_API_KEY! });
    const questions = buildSpawnQuestions({
      "research-bot": "Handles web research",
      "inbox-bot": "Triages inbox",
    });

    let aligned = 0;
    const mismatches: string[] = [];

    for (const c of LIVE_SPAWN_CASES) {
      const result = await service.decide({
        purpose: "spawn",
        state: c.state,
        questions,
      });
      const gate = evaluateSpawnGate({ capsOk: true, answers: result.answers });
      if (gate.allow === c.expectedAllow) aligned += 1;
      else mismatches.push(`${c.id}: expected allow=${c.expectedAllow} got ${gate.allow}`);
    }

    // Reports score for tuning; does not gate CI on Jev accuracy.
    console.info(`spawn live eval: ${aligned}/${LIVE_SPAWN_CASES.length} aligned`);
    if (mismatches.length > 0) console.info(mismatches.join("\n"));
    expect(LIVE_SPAWN_CASES.length).toBeGreaterThan(0);
  }, 60_000);
});
