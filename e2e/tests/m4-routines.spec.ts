import { test, expect } from "@playwright/test";
import {
  api,
  callTool,
  connectWs,
  createBot,
  eventually,
  sessionTokenFor,
  startTestHarness,
  type TestHarness,
} from "../src/harness.js";

interface Run {
  id: string;
  dryRun: boolean;
  status: string;
  plannedActions?: string[];
  resultSummary?: string;
}

interface Approval {
  id: string;
  kind: string;
  botId: string;
}

/**
 * The fake engine acts out `@approve` (an engine-native tool asking permission)
 * and `@tool` (an OpenBot MCP call through the server injected for the turn).
 */
const ROUTINE_PROMPT = [
  "Summarize yesterday's activity and email it to me.",
  '@approve send_email {"url":"mailto:me@example.com","body":"summary"}',
  '@tool message_user {"kind":"result","body":"Daily summary ready"}',
].join("\n");

async function runsOf(harness: TestHarness, routineId: string): Promise<Run[]> {
  return (await api<{ runs: Run[] }>(harness, `/api/routines/${routineId}/runs`)).body.runs;
}

async function pendingApproval(
  harness: TestHarness,
  match: (a: Approval) => boolean,
): Promise<Approval> {
  return eventually(async () => {
    const res = await api<{ approvals: Approval[] }>(harness, "/api/approvals?status=pending");
    return res.body.approvals.find(match);
  });
}

test.describe("M4 Routines (fake engine and Jev)", () => {
  test("first run is a real dry run listing planned actions; live needs the user's OK", async () => {
    const harness = await startTestHarness();
    try {
      const { bot, thread } = await createBot(harness, {
        name: "Digest Bot",
        description: "writes my morning summary",
        routing: { mode: "pinned", engine: "fake" },
      });
      const token = await sessionTokenFor(harness, { botId: bot.id });

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

      const created = await callTool<{ allowed: boolean; routineId: string }>(
        harness,
        token,
        "create_routine",
        {
          name: "Daily summary",
          prompt: ROUTINE_PROMPT,
          trigger: { type: "schedule", cron: "0 8 * * *", timezone: "UTC", catchUp: "none" },
        },
      );
      expect(created.allowed).toBe(true);

      // The first run is a dry run of the Bot's real turn: its actions are recorded, not executed.
      const dryRun = await eventually(async () =>
        (await runsOf(harness, created.routineId)).find((r) => r.status === "done"),
      );
      expect(dryRun.dryRun).toBe(true);
      expect(dryRun.plannedActions).toEqual([
        "would send_email: mailto:me@example.com",
        "would message_user: Daily summary ready",
      ]);
      const afterDryRun = await api<{ messages: unknown[] }>(
        harness,
        `/api/threads/${thread.id}/messages`,
      );
      expect(afterDryRun.body.messages).toEqual([]);

      // Side effects were planned, so live runs wait for the user's card.
      const routineBefore = await api<{ routine: { liveApproved: boolean } }>(
        harness,
        `/api/routines/${created.routineId}`,
      );
      expect(routineBefore.body.routine.liveApproved).toBe(false);
      const liveCard = await pendingApproval(harness, (a) => a.kind === "routine_live");
      const ws = await connectWs(harness);
      expect(
        (await ws.command("approval.resolve", { id: liveCard.id, resolution: "allow" })).ok,
      ).toBe(true);
      const routineAfter = await api<{ routine: { liveApproved: boolean } }>(
        harness,
        `/api/routines/${created.routineId}`,
      );
      expect(routineAfter.body.routine.liveApproved).toBe(true);

      // A live run really acts: the email still needs its own approval card.
      const queued = await ws.command<{ runId: string }>("routine.run", {
        routineId: created.routineId,
        dryRun: false,
      });
      expect(queued.ok).toBe(true);
      const emailCard = await pendingApproval(
        harness,
        (a) => a.kind === "tool" && a.botId === bot.id,
      );
      await ws.command("approval.resolve", { id: emailCard.id, resolution: "allow" });
      ws.close();

      const liveRun = await eventually(async () =>
        (await runsOf(harness, created.routineId)).find(
          (r) => r.id === queued.runId && r.status !== "queued" && r.status !== "running",
        ),
      );
      expect(liveRun).toMatchObject({ dryRun: false, status: "done" });
      const afterLive = await api<{ messages: Array<{ text: string; proactive: boolean }> }>(
        harness,
        `/api/threads/${thread.id}/messages?delivery=held`,
      );
      // The fake Jev is unsure, so the notify gate holds the result for the digest.
      expect(afterLive.body.messages.map((m) => m.text)).toContain("Daily summary ready");
    } finally {
      await harness.close();
    }
  });
});
