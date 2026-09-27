import { test, expect } from "@playwright/test";
import {
  api,
  callTool,
  connectWs,
  createBot,
  sessionTokenFor,
  startTestHarness,
} from "../src/harness.js";

test.describe("M3 Computer (fake provider and Jev)", () => {
  test("a Bot's computer_task runs on the provider and is recorded", async () => {
    const harness = await startTestHarness();
    try {
      const { bot } = await createBot(harness, {
        name: "Computer Bot",
        description: "runs computer tasks",
        computer: "docker",
        routing: { mode: "pinned", engine: "fake" },
      });
      const status = await api<{ provider?: string }>(harness, "/api/computer/status");
      expect(status.status).toBe(200);

      const ws = await connectWs(harness);
      const { chainId } = await ws.command<{ chainId: string }>("message.send", {
        botId: bot.id,
        text: "check my inbox",
      });
      ws.close();
      const token = await sessionTokenFor(harness, { botId: bot.id, chainId });

      const task = await callTool<{ allowed: boolean; taskId: string; status: string }>(
        harness,
        token,
        "computer_task",
        { goal: "open inbox and read latest email" },
      );
      expect(task.allowed).toBe(true);
      expect(task.taskId).toMatch(/^ctask_/);

      const tasks = await api<{ tasks: Array<{ id: string; botId: string; status: string }> }>(
        harness,
        "/api/computer/tasks",
      );
      expect(tasks.body.tasks.find((t) => t.id === task.taskId)).toMatchObject({
        botId: bot.id,
        status: task.status,
      });
    } finally {
      await harness.close();
    }
  });

  test("in a dry-run chain the computer is never touched", async () => {
    const harness = await startTestHarness();
    try {
      const { bot } = await createBot(harness, {
        name: "Computer Bot",
        description: "runs computer tasks",
        computer: "docker",
        routing: { mode: "pinned", engine: "fake" },
      });
      const token = await sessionTokenFor(harness, { botId: bot.id, mode: "dry_run" });
      const task = await callTool<{ allowed: boolean; status: string }>(
        harness,
        token,
        "computer_task",
        { goal: "delete all my emails" },
      );
      expect(task).toMatchObject({ allowed: true, status: "simulated" });
      const tasks = await api<{ tasks: unknown[] }>(harness, "/api/computer/tasks");
      expect(tasks.body.tasks).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});
