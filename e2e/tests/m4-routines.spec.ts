import { test, expect } from "@playwright/test";
import { startTestHarness } from "../src/harness.js";

const DEFAULT_LIMITS = {
  perRun: { usd: 0.5, tokens: 200_000, turns: 10, computerSteps: 50, wallMin: 15 },
  dailyUsd: 2,
  maxRunsPerDay: 24,
  cooldownSec: 60,
};

test.describe("M4 Routines", () => {
  test("first routine run is a dry run with planned actions", async () => {
    const harness = await startTestHarness();
    try {
      const botRes = await fetch(`${harness.baseUrl}/api/bots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Routine Bot",
          description: "runs routines",
          routing: { mode: "pinned", engine: "fake" },
        }),
      });
      expect(botRes.ok).toBe(true);
      const { bot } = (await botRes.json()) as { bot: { id: string } };

      const routineRes = await fetch(`${harness.baseUrl}/api/routines`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          botId: bot.id,
          name: "Daily summary",
          prompt: "Summarize workspace activity",
          trigger: { type: "schedule", cron: "0 8 * * *", timezone: "UTC", catchUp: "none" },
          limits: DEFAULT_LIMITS,
        }),
      });
      expect(routineRes.status).toBe(201);
      const { routine } = (await routineRes.json()) as { routine: { id: string; liveApproved: boolean } };
      expect(routine.liveApproved).toBe(false);

      const runsRes = await fetch(`${harness.baseUrl}/api/routines/${routine.id}/runs`);
      expect(runsRes.ok).toBe(true);
    } finally {
      await harness.close();
    }
  });
});
