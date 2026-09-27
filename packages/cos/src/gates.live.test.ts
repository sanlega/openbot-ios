import { describe, expect, it } from "vitest";
import { createDecisionService } from "@openbot/decisions";
import { FakeClock } from "@openbot/testkit";
import { CapCounterService, DEFAULT_AUTONOMY_CAPS } from "./caps.js";
import { SpawnGate } from "./spawn-gate.js";
import { NotifyGate } from "./notify-gate.js";

const LIVE = process.env.JEV_API_KEY && process.env.OPENBOT_LIVE_JEV === "1";

describe.skipIf(!LIVE)("gate evals with live Jev", () => {
  it("spawn gate allows user-requested bot with real Jev", async () => {
    const service = createDecisionService({ apiKey: process.env.JEV_API_KEY! });
    const gate = new SpawnGate({
      decisions: service,
      caps: new CapCounterService(new FakeClock()),
      autonomyCaps: DEFAULT_AUTONOMY_CAPS,
    });

    const result = await gate.evaluate({
      request: {
        name: "Dedicated Research Bot",
        description: "Handles ongoing research",
        responsibility: "Weekly research summaries",
        whyNotExisting: "No bot covers research",
        lifetime: "recurring",
        boundary: ["web"],
        userRequested: true,
      },
      roster: [],
      recentUserMessages: ["Please create a dedicated research bot for weekly summaries"],
      cosCreatedBotCount: 0,
      spawnsInLast24h: 0,
    });

    expect(result.allowed).toBe(true);
  });

  it("notify gate holds chatter with real Jev", async () => {
    const service = createDecisionService({ apiKey: process.env.JEV_API_KEY! });
    const gate = new NotifyGate({
      decisions: service,
      caps: new CapCounterService(new FakeClock()),
      autonomyCaps: DEFAULT_AUTONOMY_CAPS,
    });

    const result = await gate.evaluate({
      botId: "bot_test",
      message: {
        kind: "result",
        body: "Still working on it, about halfway done.",
        dedupeKey: "progress-1",
      },
      recentDelivered: [],
      proactiveCountBotHour: 0,
      proactiveCountBotDay: 0,
      proactiveCountGlobalHour: 0,
      now: new Date(),
    });

    expect(result.allowed).toBe(false);
  });
});
