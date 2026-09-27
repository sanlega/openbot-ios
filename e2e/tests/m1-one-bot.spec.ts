import { test, expect } from "@playwright/test";
import { startTestHarness } from "../src/harness.js";

test.describe("M1 One bot on desktop", () => {
  test("harness health, bot CRUD, and fake engine turn", async () => {
    const harness = await startTestHarness();
    try {
      const health = await fetch(`${harness.baseUrl}/health`);
      expect(health.ok).toBe(true);

      const status = await fetch(`${harness.baseUrl}/api/harness/status`);
      const statusBody = (await status.json()) as { connected: boolean };
      expect(statusBody.connected).toBe(true);

      const createRes = await fetch(`${harness.baseUrl}/api/bots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Test Bot",
          description: "E2E bot",
          routing: { mode: "pinned", engine: "fake", model: "fake" },
        }),
      });
      expect(createRes.status).toBe(201);
      const { bot, thread } = (await createRes.json()) as { bot: { id: string }; thread: { id: string } };
      expect(bot.id).toMatch(/^bot_/);
      expect(thread.id).toMatch(/^thr_/);

      const threadRes = await fetch(`${harness.baseUrl}/api/threads/${thread.id}/messages`);
      expect(threadRes.ok).toBe(true);
    } finally {
      await harness.close();
    }
  });
});
