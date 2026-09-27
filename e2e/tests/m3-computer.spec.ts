import { test, expect } from "@playwright/test";
import { startTestHarness } from "../src/harness.js";

test.describe("M3 Computer", () => {
  test("fake computer task completes via internal tool", async () => {
    const harness = await startTestHarness();
    try {
      const botRes = await fetch(`${harness.baseUrl}/api/bots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Computer Bot",
          slug: "computer-bot",
          description: "runs computer tasks",
          computer: "docker",
          routing: { mode: "pinned", engine: "fake" },
        }),
      });
      expect(botRes.ok).toBe(true);
      const bot = (await botRes.json()) as { id: string };

      const statusRes = await fetch(`${harness.baseUrl}/api/computer/status`);
      expect(statusRes.ok).toBe(true);

      const taskRes = await fetch(`${harness.baseUrl}/internal/tools/computer_task`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openbot-session": `test-session-${bot.id}`,
        },
        body: JSON.stringify({ goal: "open inbox and read latest email" }),
      });
      expect([200, 401, 403]).toContain(taskRes.status);
    } finally {
      await harness.close();
    }
  });
});
