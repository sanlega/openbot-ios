import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { api, createBot, eventually, startTestHarness } from "../src/harness.js";

const form = {
  title: "About you",
  intro: "So I can help better.",
  fields: [
    { id: "name", type: "text", label: "What should I call you?", required: true },
    { id: "tone", type: "choice", label: "Replies", options: ["Short", "Detailed"] },
    { id: "daily", type: "confirm", label: "Daily summary?" },
    { id: "api_key", type: "secret", label: "Notion token" },
  ],
};

test.describe("Bots ask the user with forms (ask_user)", () => {
  test("the user answers in the card; the Bot gets the answers; the secret stays in the vault", async ({
    page,
  }) => {
    const harness = await startTestHarness();
    try {
      await api(harness, "/api/setup/complete", { body: {} });
      const { bot, thread } = await createBot(harness, {
        name: "Helper",
        description: "helps",
        routing: { mode: "pinned", engine: "fake" },
      });
      await page.goto(`${harness.baseUrl}/app/`);
      await page.getByTestId("bot-list").getByText("Helper").click();
      await page.getByLabel("Message").fill(`@tool ask_user ${JSON.stringify(form)}`);
      await page.getByRole("button", { name: "Send" }).click();

      const card = page.getByRole("form", { name: "About you" });
      await expect(card).toBeVisible();
      await card.getByRole("button", { name: "Send answers" }).click();
      await expect(card.getByRole("alert")).toContainText("required");

      await card.getByLabel("What should I call you?").fill("Alex");
      await card.getByRole("radio", { name: "Short" }).click();
      await card.getByRole("radio", { name: "Yes" }).click();
      await card.getByLabel("Notion token").fill("secret_ntn_12345");
      await card.getByRole("button", { name: "Send answers" }).click();

      await expect(page.getByTestId("thread-messages")).toContainText("Answered");
      const history = await eventually(async () => {
        const res = await api<{ messages: Array<{ text: string; author: { type: string } }> }>(
          harness,
          `/api/threads/${thread.id}/messages`,
        );
        const answers = res.body.messages.find((m) => m.text.startsWith("My answers"));
        const replies = res.body.messages.filter((m) => m.author.type === "bot");
        return answers && replies.length >= 2 ? { answers, all: res.body.messages } : undefined;
      });
      expect(history.answers.text).toContain("What should I call you? (name): Alex");
      expect(history.answers.text).toContain("Replies (tone): Short");
      expect(history.answers.text).toContain("Daily summary? (daily): yes");
      expect(JSON.stringify(history.all)).not.toContain("secret_ntn_12345");

      const inputs = await api<{
        inputs: Array<{ status: string; answers: Record<string, unknown> }>;
      }>(harness, `/api/inputs?botId=${bot.id}`);
      expect(inputs.body.inputs[0]).toMatchObject({ status: "answered" });
      expect(JSON.stringify(inputs.body)).not.toContain("secret_ntn_12345");
      const eventLog = await readFile(join(harness.home, "openbot.db")).catch(() =>
        Buffer.from(""),
      );
      expect(eventLog.includes("secret_ntn_12345")).toBe(false);
    } finally {
      await harness.close();
    }
  });
});
