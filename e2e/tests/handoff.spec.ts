import { test, expect } from "@playwright/test";
import { api, connectWs, createBot, eventually, startTestHarness } from "../src/harness.js";

interface ThreadMessages {
  messages: Array<{ text: string; author: { type: string; id?: string } }>;
}

test.describe("Bot-to-bot handoff (fake engine and Jev)", () => {
  test("a Bot that receives a task from the CoS runs a turn and answers it, with no approval card", async () => {
    const harness = await startTestHarness();
    try {
      const { bot: cos } = await createBot(harness, {
        name: "Chief",
        description: "chief of staff",
        isChiefOfStaff: true,
        routing: { mode: "pinned", engine: "fake" },
      });
      const { bot: writer, thread: writerThread } = await createBot(harness, {
        name: "Writer",
        description: "writes",
        routing: { mode: "pinned", engine: "fake" },
      });

      const ws = await connectWs(harness);
      const sent = await ws.command("message.send", {
        botId: cos.id,
        text: `@tool send_message ${JSON.stringify({ bot: "writer", text: "write a haiku" })}`,
      });
      expect(sent.ok).toBe(true);

      const writerTurn = await ws.waitForEvent(
        (e) => e.type === "turn.completed" && e.botId === writer.id,
      );
      ws.close();

      const history = await eventually(async () => {
        const res = await api<ThreadMessages>(harness, `/api/threads/${writerThread.id}/messages`);
        return res.body.messages.length >= 2 ? res.body.messages : undefined;
      });
      expect(history.some((m) => m.author.id === cos.id && m.text === "write a haiku")).toBe(true);
      expect(history.some((m) => m.author.type === "bot" && m.author.id === writer.id)).toBe(true);
      expect(writerTurn.chainId).toBe((sent as { chainId?: string }).chainId);

      const approvals = await api<{ approvals: unknown[] }>(harness, "/api/approvals");
      expect(approvals.body.approvals).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });
});
