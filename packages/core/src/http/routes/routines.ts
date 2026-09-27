import type { FastifyInstance } from "fastify";
import { newId } from "@openbot/contracts";
import type { CoreContext } from "../../context.js";
import { requireAuth } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { CreateRoutineBody, RunRoutineBody, UpdateRoutineBody } from "../schemas.js";

/**
 * Routines CRUD, pause/resume/enable-live (pure state, doable now), run
 * history, and `run` (needs WS12's scheduler/orchestrator — 501 until wired).
 */
export function registerRoutineRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/routines", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { botId } = request.query as { botId?: string };
    return { routines: botId ? ctx.repos.routines.listByBot(botId) : ctx.repos.routines.list() };
  });

  app.post("/api/routines", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const body = parseOrReject(CreateRoutineBody, request.body, reply);
    if (!body) return;
    if (!ctx.repos.bots.getById(body.botId))
      return reply.code(404).send({ error: "bot_not_found" });

    const routine = {
      id: newId("routine"),
      botId: body.botId,
      name: body.name,
      prompt: body.prompt,
      createdBy: "user" as const,
      enabled: true,
      liveApproved: false,
      trigger: body.trigger,
      limits: body.limits,
      consecutiveFailures: 0,
      createdAt: ctx.clock.now().toISOString(),
    };
    ctx.repos.routines.create(routine);
    await ctx.eventBus.publish({
      type: "routine.created",
      botId: routine.botId,
      payload: { routine },
    });
    reply.code(201);
    return { routine };
  });

  app.get("/api/routines/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const routine = ctx.repos.routines.getById(id);
    if (!routine) return reply.code(404).send({ error: "not_found" });
    return { routine };
  });

  app.patch("/api/routines/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!ctx.repos.routines.getById(id)) return reply.code(404).send({ error: "not_found" });
    const patch = parseOrReject(UpdateRoutineBody, request.body, reply);
    if (!patch) return;
    ctx.repos.routines.update(id, patch);
    const routine = ctx.repos.routines.getById(id);
    await ctx.eventBus.publish({
      type: "routine.updated",
      botId: routine?.botId,
      payload: { id, patch },
    });
    return { routine };
  });

  app.delete("/api/routines/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const routine = ctx.repos.routines.getById(id);
    if (!routine) return reply.code(404).send({ error: "not_found" });
    ctx.repos.routines.delete(id);
    await ctx.eventBus.publish({ type: "routine.deleted", botId: routine.botId, payload: { id } });
    return { ok: true };
  });

  app.post("/api/routines/:id/pause", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const routine = ctx.repos.routines.getById(id);
    if (!routine) return reply.code(404).send({ error: "not_found" });
    const { reason } = (request.body as { reason?: string } | undefined) ?? {};
    ctx.repos.routines.update(id, { enabled: false, pausedReason: reason ?? "paused by user" });
    await ctx.eventBus.publish({ type: "routine.paused", botId: routine.botId, payload: { id } });
    return { routine: ctx.repos.routines.getById(id) };
  });

  app.post("/api/routines/:id/resume", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const routine = ctx.repos.routines.getById(id);
    if (!routine) return reply.code(404).send({ error: "not_found" });
    ctx.repos.routines.update(id, { enabled: true, pausedReason: undefined });
    await ctx.eventBus.publish({ type: "routine.resumed", botId: routine.botId, payload: { id } });
    return { routine: ctx.repos.routines.getById(id) };
  });

  app.post("/api/routines/:id/enable-live", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!ctx.repos.routines.getById(id)) return reply.code(404).send({ error: "not_found" });
    ctx.repos.routines.update(id, { liveApproved: true });
    return { routine: ctx.repos.routines.getById(id) };
  });

  // Actually running a routine (live or dry-run) needs WS12's scheduler/
  // orchestrator to build a chain and drive an engine turn.
  app.post("/api/routines/:id/run", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.repos.routines.getById((request.params as { id: string }).id)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const body = parseOrReject(RunRoutineBody, request.body ?? {}, reply);
    if (!body) return;
    return reply
      .code(501)
      .send({ error: "not_implemented", reason: "routine orchestration not wired yet (WS12)" });
  });

  app.get("/api/routines/:id/runs", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    return { runs: ctx.repos.routineRuns.listByRoutine(id) };
  });

  app.get("/api/runs/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const run = ctx.repos.routineRuns.getById(id);
    if (!run) return reply.code(404).send({ error: "not_found" });
    return { run };
  });
}
