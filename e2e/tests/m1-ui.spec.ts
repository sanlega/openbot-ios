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
      await page.getByText("Helper").first().click();

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
        input: { file_path: "/opt/outside-workspace/todo.md", content: "..." },
      });

      // The card sits at the bottom of the chat, after the messages.
      const lastInThread = page.getByTestId("thread-messages").locator(":scope > *").last();
      await expect(lastInThread).toHaveAttribute("data-testid", /^approval-/);
      await page.getByRole("button", { name: "Allow" }).first().click();
      expect(await prompt).toMatchObject({ allowed: true, behavior: "allow" });
    } finally {
      await harness.close();
    }
  });
});

test.describe("First run in the real UI", () => {
  test("setup seeds the Chief of Staff, and the user can add a Bot from the roster", async ({
    page,
  }) => {
    const harness = await startTestHarness();
    try {
      await api(harness, "/api/setup/complete", { body: {} });
      await page.goto(`${harness.baseUrl}/app/`);
      const roster = page.getByTestId("bot-list");
      await expect(roster).toContainText("Chief of Staff");

      await page.getByRole("button", { name: "New bot" }).click();
      await page.getByLabel("Bot name").fill("Writer");
      await page.getByLabel("Bot description").fill("drafts posts");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(roster).toContainText("Writer");

      const bots = await api<{ bots: Array<{ name: string; isChiefOfStaff: boolean }> }>(
        harness,
        "/api/bots",
      );
      expect(bots.body.bots.filter((b) => b.isChiefOfStaff)).toHaveLength(1);
      expect(bots.body.bots.map((b) => b.name)).toContain("Writer");
    } finally {
      await harness.close();
    }
  });
});

test.describe("Turn steps in the real UI", () => {
  test("what the Bot did is folded above its reply and opens on click", async ({ page }) => {
    const harness = await startTestHarness();
    try {
      await api(harness, "/api/setup/complete", { body: {} });
      await createBot(harness, {
        name: "Helper",
        description: "helps",
        routing: { mode: "pinned", engine: "fake" },
      });
      await page.goto(`${harness.baseUrl}/app/`);
      await page.getByTestId("bot-list").getByText("Helper").click();
      await page.getByLabel("Message").fill("@tool list_bots {}");
      await page.getByRole("button", { name: "Send" }).click();

      const steps = page.getByTestId("turn-steps").last();
      await expect(steps).toContainText("1 step");
      await expect(steps.getByText("list bots")).toBeHidden();
      await steps.locator("summary").click();
      await expect(steps.getByText("list bots")).toBeVisible();
    } finally {
      await harness.close();
    }
  });
});

test.describe("Bot profile in the real UI", () => {
  test("the user edits a Bot's name and picks its model from the list", async ({ page }) => {
    const harness = await startTestHarness();
    try {
      await api(harness, "/api/setup/complete", { body: {} });
      const { bot } = await createBot(harness, { name: "Helper", description: "helps" });
      await page.goto(`${harness.baseUrl}/app/`);
      await page.getByTestId("bot-list").getByText("Helper").click();
      await page.getByRole("button", { name: "Profile", exact: true }).click();

      const profile = page.getByTestId("bot-profile");
      await profile.getByRole("textbox").first().fill("Helper Pro");
      const models = await api<{
        engines: Array<{ engine: string; models: Array<{ id: string }> }>;
      }>(harness, "/api/models");
      const engine = models.body.engines[0]!;
      const model = engine.models[0]!.id;
      await profile.getByLabel("Model").selectOption(`${engine.engine}:${model}`);
      await profile.getByRole("button", { name: "Save" }).click();
      await expect(profile).toContainText("Saved");

      const saved = await api<{ bot: { name: string; routing: Record<string, unknown> } }>(
        harness,
        `/api/bots/${bot.id}`,
      );
      expect(saved.body.bot.name).toBe("Helper Pro");
      expect(saved.body.bot.routing).toMatchObject({
        mode: "pinned",
        engine: engine.engine,
        model,
      });

      await profile.getByRole("button", { name: "Archive bot" }).click();
      await profile.getByRole("button", { name: "Archive", exact: true }).click();
      await expect(page.getByTestId("bot-list")).not.toContainText("Helper Pro");
      const archived = await api<{ bot: { archivedAt?: string } }>(harness, `/api/bots/${bot.id}`);
      expect(archived.body.bot.archivedAt).toBeDefined();
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
      await page.getByTestId("bot-list").getByText("Helper").click();
      await page.getByRole("button", { name: "Profile", exact: true }).click();
      await expect(page.getByTestId("bot-profile")).toBeVisible();
      await page.getByRole("button", { name: "Computer", exact: true }).click();
      await page.getByRole("button", { name: "Start computer" }).click();
      await expect(page.getByRole("button", { name: "Take over screen" })).toBeVisible();

      expect(errors).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});
