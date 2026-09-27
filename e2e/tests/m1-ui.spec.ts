import { test, expect } from "@playwright/test";
import { api, callTool, createBot, sessionTokenFor, startTestHarness } from "../src/harness.js";

test.describe("M1 in the real UI (PWA served by the harness)", () => {
  test("chat with a Bot and answer its approval card from the UI", async ({ page }) => {
    const harness = await startTestHarness();
    try {
      await api(harness, "/api/setup/complete", { body: {} });
      const { bot } = await createBot(harness, {
        name: "Helper",
        description: "helps with things",
        routing: { mode: "pinned", engine: "fake" },
      });

      await page.goto(`${harness.baseUrl}/app/`);
      await expect(page.getByText("Helper").first()).toBeVisible();

      await page.getByLabel("Message").fill("summarize my notes");
      await page.getByRole("button", { name: "Send" }).click();
      const messages = page.getByTestId("thread-messages");
      await expect(messages).toContainText("summarize my notes");
      await expect(messages).toContainText("Sure, I can help with that.");

      // Playing the engine: a file write asks permission and blocks on the card.
      const chains = await api<{ messages: Array<{ chainId?: string }> }>(
        harness,
        `/api/activity?botId=${bot.id}`,
      );
      const token = await sessionTokenFor(harness, {
        botId: bot.id,
        chainId: chains.body.messages[0]?.chainId,
      });
      const prompt = callTool<{ behavior: string }>(harness, token, "permission_prompt", {
        tool_name: "Write",
        input: { file_path: "notes/summary.md", content: "..." },
      });

      await page.getByRole("button", { name: "Allow" }).first().click();
      expect(await prompt).toMatchObject({ allowed: true, behavior: "allow" });
    } finally {
      await harness.close();
    }
  });
});

test.describe("Every screen of the real UI loads against the harness", () => {
  test("nav screens and bot panels render without errors", async ({ page }) => {
    const harness = await startTestHarness();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
    });
    try {
      await api(harness, "/api/setup/complete", { body: {} });
      await createBot(harness, {
        name: "Helper",
        description: "helps",
        computer: "docker",
        routing: { mode: "pinned", engine: "fake" },
      });
      const screens: Array<[string, string]> = [
        ["Activity", "activity-view"],
        ["Audit", "audit-view"],
        ["Routines", "routines-view"],
        ["Settings", "settings-view"],
        ["Devices", "devices-view"],
      ];
      for (const [tab, testId] of screens) {
        await page.goto(`${harness.baseUrl}/app/`);
        await page.getByRole("button", { name: tab, exact: true }).first().click();
        await expect(page.getByTestId(testId)).toBeVisible();
      }

      await page.goto(`${harness.baseUrl}/app/`);
      await page.getByRole("button", { name: "Profile", exact: true }).click();
      await expect(page.getByText("Why does this bot exist?")).toBeVisible();
      await page.getByRole("button", { name: "Computer", exact: true }).click();
      await page.getByRole("button", { name: "Start computer" }).click();
      await expect(page.getByRole("button", { name: "Take over screen" })).toBeVisible();

      expect(errors).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});
