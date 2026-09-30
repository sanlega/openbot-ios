import type { FastifyInstance } from "fastify";
import type { CoreContext } from "../../context.js";
import { requireAuth } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { ComputerImageBuildBody, ComputerImageResetBody, TakeoverBody } from "../schemas.js";

/**
 * Computer status/tasks (plan §4.7 "Computer"). Task history is a DB read
 * that always works; starting the provider, live view, and takeover need a
 * real `ComputerProvider` (WS9) — deferred with 501 until one is wired into
 * `CoreContext`.
 */
export function registerComputerRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/computer/status", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.computerProvider)
      return { ready: false, detail: "no ComputerProvider wired yet (WS9)" };
    return { ...(await ctx.computerProvider.status()), provider: ctx.computerProvider.id };
  });

  app.post("/api/computer/start", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.computerProvider)
      return reply.code(501).send({ error: "not_implemented", reason: "WS9" });
    if (ctx.computerImageManager && ctx.computerImageManager.getStatus().state !== "ready") {
      return reply.code(409).send({
        error: "image_missing",
        reason: "the desktop image isn't ready yet — get it from Settings > Computer",
      });
    }
    try {
      await ctx.computerProvider.ensureStarted();
    } catch (error) {
      return reply.code(500).send({
        error: "start_failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return ctx.computerProvider.status();
  });

  app.get("/api/computer/image", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.computerImageManager)
      return reply
        .code(501)
        .send({ error: "not_implemented", reason: "not using the docker provider" });
    return ctx.computerImageManager.getStatus();
  });

  app.post("/api/computer/image/build", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.computerImageManager)
      return reply
        .code(501)
        .send({ error: "not_implemented", reason: "not using the docker provider" });
    const body = parseOrReject(ComputerImageBuildBody, request.body ?? {}, reply);
    if (!body) return;
    const manager = ctx.computerImageManager;
    if (manager.isBusy()) return reply.code(409).send({ error: "already_in_progress" });
    if (body.source === "local" && !manager.getStatus().localBuildAvailable) {
      return reply.code(400).send({ error: "local_build_unavailable" });
    }
    void manager.get(body.source).catch(() => {
      // Failure is already reflected in getStatus()/`computer.image_status` via the manager's onStatus hook.
    });
    // get() runs synchronously up to its first internal await, so by here it has
    // already flipped `busy`/state to "pulling" or "building" — safe to read back.
    reply.code(202);
    return manager.getStatus();
  });

  app.post("/api/computer/image/reset", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.computerImageManager)
      return reply
        .code(501)
        .send({ error: "not_implemented", reason: "not using the docker provider" });
    const body = parseOrReject(ComputerImageResetBody, request.body ?? {}, reply);
    if (!body) return;
    const manager = ctx.computerImageManager;
    if (manager.isBusy()) return reply.code(409).send({ error: "already_in_progress" });
    void manager.reset(body.removeImage).catch(() => {
      // Failure is already reflected in getStatus()/`computer.image_status` via the manager's onStatus hook.
    });
    reply.code(202);
    return { state: "missing", tag: manager.getStatus().tag };
  });

  app.get("/api/computer/screens/:botId/live", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.computerProvider)
      return reply.code(501).send({ error: "not_implemented", reason: "WS9" });
    const { botId } = request.params as { botId: string };
    if (!(await ctx.computerProvider.status()).ready) {
      return reply.code(409).send({ error: "not_started", reason: "start the computer first" });
    }
    const screen = await ctx.computerProvider.screen(botId);
    return screen.liveView();
  });

  app.post("/api/computer/screens/:botId/takeover", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.computerProvider)
      return reply.code(501).send({ error: "not_implemented", reason: "WS9" });
    const { botId } = request.params as { botId: string };
    const body = parseOrReject(TakeoverBody, request.body, reply);
    if (!body) return;
    const screen = await ctx.computerProvider.screen(botId);
    await screen.takeover(body.on);
    await ctx.eventBus.publish({
      type: body.on ? "computer.takeover_requested" : "computer.takeover_ended",
      botId,
      payload: {},
    });
    return { ok: true };
  });

  app.get("/api/computer/tasks", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { botId } = request.query as { botId?: string };
    const rows = botId ? ctx.repos.computerTasks.listByBot(botId) : ctx.repos.computerTasks.list();
    // Live progress (steps, text the task is waiting for) for tasks still in memory.
    return {
      tasks: rows.map((row) => {
        const live = ctx.computerTasks?.get(row.id);
        return live
          ? {
              ...row,
              status: live.status,
              steps: live.steps.length,
              timeline: live.steps,
              needsText: live.pendingInput?.field,
              instructions: live.instructions,
              summary: live.summary,
              phase: live.phase,
              page: { url: live.url, title: live.title },
            }
          : row;
      }),
    };
  });

  app.post("/api/computer/tasks/:id/steer", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { instruction?: unknown; text?: unknown };
    const instruction = typeof body.instruction === "string" ? body.instruction : undefined;
    const text = typeof body.text === "string" ? body.text : undefined;
    if (instruction === undefined && text === undefined) {
      return reply.code(400).send({ error: "instruction_or_text_required" });
    }
    const task = ctx.computerTasks?.steer(id, { instruction, text });
    if (!task) return reply.code(404).send({ error: "not_found" });
    return { task };
  });

  app.post("/api/computer/tasks/:id/cancel", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const task = ctx.computerTasks?.cancel(id);
    if (!task) return reply.code(404).send({ error: "not_found" });
    return { task };
  });
}
