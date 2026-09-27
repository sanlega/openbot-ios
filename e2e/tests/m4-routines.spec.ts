import { test, expect } from "@playwright/test";
import {
  api,
  callTool,
  createBot,
  eventually,
  sessionTokenFor,
  startTestHarness,
} from "../src/harness.js";

interface Run {
  id: string;
  dryRun: boolean;
  status: string;
  plannedActions?: string[];
}

test.describe("M4 Routines (fake engine and Jev)", () => {
  test("a Bot's create_routine starts with a dry run; live needs the user", async () => {
    const harness = await startTestHarness();
    try {
      const { bot } = await createBot(harness, {
        name: "Digest Bot",
        description: "writes my morning summary",
        routing: { mode: "pinned", engine: "fake" },
      });
      const token = await sessionTokenFor(harness, { botId: bot.id });

      const created = await callTool<{
        allowed: boolean;
        routineId: string;
        dryRunQueued: boolean;
      }>(harness, token, "create_routine", {
        name: "Daily summary",
        prompt: "Summarize yesterday's activity and email it to me",
        trigger: { type: "schedule", cron: "0 8 * * *", timezone: "UTC", catchUp: "none" },
      });
      expect(created).toMatchObject({ allowed: true, dryRunQueued: true });

      const tooFrequent = await callTool<{ allowed: boolean; reason?: string }>(
        harness,
        token,
        "create_routine",
        {
          name: "Spam",
          prompt: "check every minute",
          trigger: { type: "schedule", cron: "* * * * *", timezone: "UTC", catchUp: "none" },
        },
      );
      expect(tooFrequent.allowed).toBe(false);
      expect(tooFrequent.reason).toContain("15 minute");

      const firstRun = await eventually(async () => {
        const res = await api<{ runs: Run[] }>(harness, `/api/routines/${created.routineId}/runs`);
        return res.body.runs.find((r) => r.status === "done");
      });
      expect(firstRun.dryRun).toBe(true);

      const routine = await api<{ routine: { liveApproved: boolean } }>(
        harness,
        `/api/routines/${created.routineId}`,
      );
      expect(routine.body.routine.liveApproved).toBe(false);

      const enabled = await api<{ routine: { liveApproved: boolean } }>(
        harness,
        `/api/routines/${created.routineId}/enable-live`,
        { method: "POST", body: {} },
      );
      expect(enabled.status).toBe(200);
      expect(enabled.body.routine.liveApproved).toBe(true);
    } finally {
      await harness.close();
    }
  });

  // The dry run does not run the Bot yet: RoutineRuntimeAdapter returns one fixed
  // "Would run routine ..." line instead of the actions the Bot would take.
  test.fixme("the dry run lists the side effects the Bot planned (e.g. would send email)", () => {});
});
