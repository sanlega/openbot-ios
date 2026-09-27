import type { FastifyInstance } from "fastify";
import type { CoreContext } from "../../context.js";
import { requireAuth } from "../auth.js";
import { ActivityQuery, MessagesQuery } from "../schemas.js";

/** Threads, messages, and the activity log (plan §4.7). */
export function registerThreadRoutes(app: FastifyInstance, ctx: CoreContext): void {
  // One DM thread per visible Bot, shaped for the chat list (title, preview).
  app.get("/api/threads", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const threads = ctx.repos.bots.list().flatMap((bot) => {
      const thread = ctx.repos.threads.getByBotId(bot.id);
      if (!thread) return [];
      const [last] = ctx.repos.messages.list({ threadId: thread.id, limit: 1 });
      return [
        {
          ...thread,
          participantIds: [bot.id, "user"],
          title: bot.name,
          lastMessagePreview: last?.text.slice(0, 80),
          lastMessageAt: last?.createdAt,
        },
      ];
    });
    return { threads };
  });

  app.get("/api/threads/:id/messages", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const query = ActivityQueryFromMessages(request.query);
    if (!query) return reply.code(400).send({ error: "invalid_request" });
    return { messages: ctx.repos.messages.list({ threadId: id, delivery: query.delivery }) };
  });

  // Stops the Bot's active turn and drops its queued ones (M1 "stop mid-turn").
  app.post("/api/threads/:id/stop", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const thread = ctx.repos.threads.getById(id);
    if (!thread) return reply.code(404).send({ error: "not_found" });
    if (!ctx.mailbox) {
      return reply.code(501).send({ error: "not_implemented", reason: "turn mailbox not wired" });
    }
    return ctx.mailbox.stopBot(thread.botId);
  });

  app.get("/api/activity", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const query = ActivityQuery.safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({ error: "invalid_request", issues: query.error.issues });

    const threadId = query.data.botId
      ? ctx.repos.threads.getByBotId(query.data.botId)?.id
      : undefined;
    if (query.data.botId && !threadId) return { messages: [] };
    return { messages: ctx.repos.messages.list({ threadId, delivery: query.data.delivery }) };
  });

  app.post("/api/messages/:id/promote", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const message = ctx.repos.messages.getById(id);
    if (!message) return reply.code(404).send({ error: "not_found" });

    ctx.repos.messages.updateDelivery(id, "delivered");
    if (message.notifyDecisionId)
      ctx.repos.decisions.setFeedback(message.notifyDecisionId, "promote");
    await ctx.eventBus.publish({
      type: "message.completed",
      threadId: message.threadId,
      payload: { id, delivery: "delivered" },
    });
    return { message: ctx.repos.messages.getById(id) };
  });

  app.post("/api/messages/:id/mute", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const message = ctx.repos.messages.getById(id);
    if (!message) return reply.code(404).send({ error: "not_found" });

    if (message.notifyDecisionId) ctx.repos.decisions.setFeedback(message.notifyDecisionId, "mute");
    return { message };
  });

  // Uploads: a minimal raw-body implementation (no multipart parsing yet).
  // Send the file's bytes as the request body with `X-Filename` set; the
  // response is the path under `uploadsDir` the WS2 mailbox can attach.
  app.post("/api/uploads", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const filenameHeader = request.headers["x-filename"];
    const filename = Array.isArray(filenameHeader) ? filenameHeader[0] : filenameHeader;
    if (!filename)
      return reply
        .code(400)
        .send({ error: "invalid_request", reason: "missing X-Filename header" });

    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { newId } = await import("@openbot/contracts");
    const id = newId("message").replace("msg_", "upl_");
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = join(ctx.config.uploadsDir, `${id}-${safeName}`);
    const body = request.body;
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : "");
    await writeFile(path, buffer);
    reply.code(201);
    return { id, path, filename: safeName };
  });
}

function ActivityQueryFromMessages(
  query: unknown,
): { delivery?: "delivered" | "held" | "merged" } | undefined {
  const result = MessagesQuery.safeParse(query);
  return result.success ? result.data : undefined;
}
