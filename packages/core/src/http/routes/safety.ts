import type { FastifyInstance } from "fastify";
import { newId } from "@openbot/contracts";
import type { CoreContext } from "../../context.js";
import { requireAuth, requireOwner } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { CreateRuleBody, ResolveApprovalBody } from "../schemas.js";

/** Approvals, chain resume/stop, and permission rules (plan §4.7 "Safety"). */
export function registerSafetyRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/approvals", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { status } = request.query as { status?: "pending" | "resolved" | "expired" };
    return { approvals: ctx.repos.approvals.list({ status }) };
  });

  app.post("/api/approvals/:id/resolve", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const approval = ctx.repos.approvals.getById(id);
    if (!approval) return reply.code(404).send({ error: "not_found" });
    if (approval.status !== "pending") {
      return reply.code(409).send({ error: "already_resolved", approval });
    }
    const body = parseOrReject(ResolveApprovalBody, request.body, reply);
    if (!body) return;

    ctx.repos.approvals.resolve(id, body.resolution);
    await ctx.eventBus.publish({
      type: "approval.resolved",
      botId: approval.botId,
      chainId: approval.chainId,
      payload: { id, resolution: body.resolution },
    });
    return { approval: ctx.repos.approvals.getById(id) };
  });

  app.post("/api/chains/:id/resume", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!ctx.repos.chains.getById(id)) return reply.code(404).send({ error: "not_found" });
    ctx.repos.chains.setStatus(id, "active");
    await ctx.eventBus.publish({ type: "chain.resumed", chainId: id, payload: {} });
    return { chain: ctx.repos.chains.getById(id) };
  });

  app.post("/api/chains/:id/stop", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!ctx.repos.chains.getById(id)) return reply.code(404).send({ error: "not_found" });
    ctx.repos.chains.setStatus(id, "stopped");
    await ctx.eventBus.publish({ type: "chain.stopped", chainId: id, payload: {} });
    return { chain: ctx.repos.chains.getById(id) };
  });

  app.get("/api/rules", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return { rules: ctx.repos.rules.list() };
  });

  // Rules gate the permission broker (WS2) at every tool/computer/connector
  // call, so only an owner device may add or remove one.
  app.post("/api/rules", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const body = parseOrReject(CreateRuleBody, request.body, reply);
    if (!body) return;
    const rule = {
      id: newId("rule"),
      ...body,
      source: "user" as const,
      createdAt: ctx.clock.now().toISOString(),
    };
    ctx.repos.rules.create(rule);
    reply.code(201);
    return { rule };
  });

  app.delete("/api/rules/:id", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const { id } = request.params as { id: string };
    ctx.repos.rules.delete(id);
    return { ok: true };
  });
}
