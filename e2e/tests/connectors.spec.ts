import { test, expect } from "@playwright/test";
import { api, connectWs, createBot, eventually, startTestHarness } from "../src/harness.js";

interface ThreadMessages {
  messages: Array<{ id: string; text: string; author: { type: string } }>;
}

interface CatalogResponse {
  entries: Array<{ id: string; connected: boolean; connectionId?: string; verified: boolean }>;
  error?: string;
}

test.describe("Connectors (curated MCP servers, per-Bot)", () => {
  test("a connected entry is injected only into the Bot it is assigned to", async () => {
    const harness = await startTestHarness();
    try {
      const catalog = await api<CatalogResponse>(harness, "/api/connectors/catalog");
      expect(catalog.status).toBe(200);
      expect(catalog.body.entries.find((e) => e.id === "curated:filesystem")).toMatchObject({
        connected: false,
        verified: true,
      });

      // The community tab degrades to an empty list when the registry is unreachable.
      const community = await api<CatalogResponse>(
        harness,
        "/api/connectors/catalog?source=community",
      );
      expect(community.status).toBe(200);
      expect(community.body.entries).toEqual([]);
      expect(community.body.error).toBeTruthy();

      const connected = await api<{ connection: { id: string; catalogId: string } }>(
        harness,
        "/api/connectors/connect",
        { body: { catalogId: "curated:filesystem", values: { FOLDER: harness.home } } },
      );
      expect(connected.status).toBe(201);
      const connectionId = connected.body.connection.id;
      const list = await api<{ connections: Array<{ id: string; catalogId: string }> }>(
        harness,
        "/api/connectors/connections",
      );
      expect(list.body.connections).toEqual([
        expect.objectContaining({ id: connectionId, catalogId: "curated:filesystem" }),
      ]);

      const withFs = await createBot(harness, {
        name: "Files Bot",
        description: "tidies files",
        routing: { mode: "pinned", engine: "fake" },
      });
      const without = await createBot(harness, {
        name: "Plain Bot",
        description: "just chats",
        routing: { mode: "pinned", engine: "fake" },
      });
      const put = await api(harness, `/api/bots/${withFs.bot.id}/connectors`, {
        method: "PUT",
        body: { connectors: [connectionId] },
      });
      expect(put).toEqual({ status: 200, body: { connectors: [connectionId] } });

      const ws = await connectWs(harness);
      for (const { bot } of [withFs, without]) {
        await ws.command("message.send", { botId: bot.id, text: "@servers" });
        await ws.waitForEvent((e) => e.type === "turn.completed" && e.botId === bot.id);
      }
      ws.close();

      const replyOf = async (threadId: string) =>
        eventually(async () => {
          const res = await api<ThreadMessages>(harness, `/api/threads/${threadId}/messages`);
          return res.body.messages.find((m) => m.author.type === "bot")?.text;
        });
      expect(await replyOf(withFs.thread.id)).toContain("[mcp servers: openbot, filesystem]");
      expect(await replyOf(without.thread.id)).toContain("[mcp servers: openbot]");

      // Disconnecting removes the connection and the Bot's assignment.
      const del = await api(harness, `/api/connectors/connections/${connectionId}`, {
        method: "DELETE",
      });
      expect(del.status).toBe(200);
      const after = await api<{ connectors: string[] }>(
        harness,
        `/api/bots/${withFs.bot.id}/connectors`,
      );
      expect(after.body.connectors).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  test("connector writes wait on an approval card; reads run", async () => {
    const harness = await startTestHarness();
    try {
      const connected = await api<{ connection: { id: string } }>(
        harness,
        "/api/connectors/connect",
        { body: { catalogId: "curated:filesystem", values: { FOLDER: harness.home } } },
      );
      const { bot, thread } = await createBot(harness, {
        name: "Files Bot",
        description: "tidies files",
        routing: { mode: "pinned", engine: "fake" },
      });
      await api(harness, `/api/bots/${bot.id}/connectors`, {
        method: "PUT",
        body: { connectors: [connected.body.connection.id] },
      });

      const ws = await connectWs(harness);
      await ws.command("message.send", {
        botId: bot.id,
        text: [
          "tidy up",
          '@approve mcp__filesystem__read_text_file {"path":"notes.md"}',
          '@approve mcp__filesystem__write_file {"path":"notes.md","content":"hi"}',
        ].join("\n"),
      });

      const card = await eventually(async () => {
        const res = await api<{
          approvals: Array<{ id: string; botId: string; kind: string; summary: string }>;
        }>(harness, "/api/approvals?status=pending");
        return res.body.approvals.find((a) => a.botId === bot.id);
      });
      // Only the write asked: the read ran without a card.
      expect(card).toMatchObject({ kind: "connector_action" });
      expect(card.summary).toContain("write_file");
      const pending = await api<{ approvals: Array<{ botId: string }> }>(
        harness,
        "/api/approvals?status=pending",
      );
      expect(pending.body.approvals.filter((a) => a.botId === bot.id)).toHaveLength(1);

      await ws.command("approval.resolve", { id: card.id, resolution: "allow" });
      await ws.waitForEvent((e) => e.type === "turn.completed" && e.botId === bot.id);
      ws.close();
      const messages = await api<ThreadMessages>(harness, `/api/threads/${thread.id}/messages`);
      expect(messages.body.messages.some((m) => m.author.type === "bot")).toBe(true);
    } finally {
      await harness.close();
    }
  });
});
