import { test, expect } from "@playwright/test";
import {
  api,
  callTool,
  connectWs,
  createBot,
  eventually,
  sessionTokenFor,
  startTestHarness,
} from "../src/harness.js";

interface ThreadMessages {
  messages: Array<{ id: string; text: string; author: { type: string } }>;
}

test.describe("M1 One bot on desktop (fake engine and Jev)", () => {
  test("chat turn: the reply lands in the thread, and history survives a restart", async () => {
    const first = await startTestHarness();
    let harness = first;
    try {
      const { bot, thread } = await createBot(harness, {
        name: "Notes Bot",
        description: "keeps my notes",
        routing: { mode: "auto" },
      });
      const ws = await connectWs(harness);
      const sent = await ws.command<{ engine: string; chainId: string }>("message.send", {
        botId: bot.id,
        text: "summarize my notes",
      });
      expect(sent).toMatchObject({ ok: true, engine: "fake" });

      const completed = await ws.waitForEvent(
        (e) => e.type === "turn.completed" && e.botId === bot.id,
      );
      expect(completed.chainId).toBe(sent.chainId);
      ws.close();

      const history = await eventually(async () => {
        const res = await api<ThreadMessages>(harness, `/api/threads/${thread.id}/messages`);
        return res.body.messages.length === 2 ? res.body.messages : undefined;
      });
      expect(history.map((m) => m.author.type).sort()).toEqual(["bot", "user"]);
      expect(history.find((m) => m.author.type === "user")?.text).toBe("summarize my notes");

      await harness.stop();
      harness = await startTestHarness({ home: first.home });
      const afterRestart = await api<ThreadMessages>(harness, `/api/threads/${thread.id}/messages`);
      expect(afterRestart.body.messages.map((m) => m.id).sort()).toEqual(
        history.map((m) => m.id).sort(),
      );
    } finally {
      await harness.stop();
      await first.close();
    }
  });

  test("a file write waits on an approval card: deny, then allow", async () => {
    const harness = await startTestHarness();
    try {
      const { bot } = await createBot(harness, {
        name: "Writer",
        description: "writes files",
        routing: { mode: "pinned", engine: "fake" },
      });
      const ws = await connectWs(harness);
      const { chainId } = await ws.command<{ chainId: string }>("message.send", {
        botId: bot.id,
        text: "write my todo list",
      });
      const token = await sessionTokenFor(harness, { botId: bot.id, chainId });

      for (const resolution of ["deny", "allow"] as const) {
        // The engine's permission prompt blocks until the user answers the card.
        const prompt = callTool<{ behavior: string }>(harness, token, "permission_prompt", {
          tool_name: "Write",
          input: { file_path: "notes/todo.md", content: "- buy milk" },
        });
        const card = await eventually(async () => {
          const res = await api<{ approvals: Array<{ id: string; botId: string }> }>(
            harness,
            "/api/approvals?status=pending",
          );
          return res.body.approvals.find((a) => a.botId === bot.id);
        });
        const resolved = await ws.command("approval.resolve", { id: card.id, resolution });
        expect(resolved.ok).toBe(true);
        expect(await prompt).toMatchObject({ allowed: true, behavior: resolution });
      }
      ws.close();
    } finally {
      await harness.close();
    }
  });
});
