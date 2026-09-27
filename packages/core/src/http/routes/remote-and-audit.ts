import type { FastifyInstance, FastifyReply } from "fastify";
import { computeBindHostFlags, type CoreContext } from "../../context.js";
import { requireAuth, requireOwner } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { CloudflareTunnelBody, DecisionsQuery } from "../schemas.js";

/**
 * Remote status (WS1 reports the live bind-host flags it derives; enabling a
 * transport is WS11's job), plus usage/audit/decisions read endpoints (plan
 * §4.7). All owner-only where the action changes machine-wide exposure.
 */
export function registerRemoteAndAuditRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/remote/status", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const flags = computeBindHostFlags(ctx);
    return { ...flags, setup: ctx.repos.setupState.get() };
  });

  app.post("/api/remote/tailscale/enable", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    return delegateOrNotImplemented(ctx, "tailscale", undefined, reply);
  });

  app.post("/api/remote/tailscale/disable", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    ctx.repos.setupState.patch({ tailscale: { ok: false } });
    return { ok: true };
  });

  app.post("/api/remote/cloudflare", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const body = parseOrReject(CloudflareTunnelBody, request.body, reply);
    if (!body) return;
    return delegateOrNotImplemented(ctx, "cloudflare", body.token, reply);
  });

  app.get("/api/usage", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { botId } = request.query as { botId?: string };
    const turns = botId ? ctx.repos.turns.listByBot(botId) : [];
    const totalUsd = turns.reduce((sum, t) => sum + (t.usage.usd ?? 0), 0);
    const totalTokens = turns.reduce(
      (sum, t) => sum + t.usage.inputTokens + t.usage.outputTokens,
      0,
    );
    return { turns, totalUsd, totalTokens };
  });

  app.get("/api/audit", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { botId } = request.query as { botId?: string };
    return {
      approvals: ctx.repos.approvals.list(),
      turns: botId ? ctx.repos.turns.listByBot(botId) : [],
    };
  });

  app.get("/api/decisions", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const query = parseOrReject(DecisionsQuery, request.query, reply);
    if (!query) return;
    return { decisions: ctx.repos.decisions.list({ purpose: query.purpose }) };
  });
}

async function delegateOrNotImplemented(
  ctx: CoreContext,
  kind: "tailscale" | "cloudflare",
  value: string | undefined,
  reply: FastifyReply,
): Promise<unknown> {
  const validator = ctx.validators[kind];
  if (!validator) {
    return reply
      .code(501)
      .send({ error: "not_implemented", reason: `${kind} manager not wired yet (WS11)` });
  }
  const result = await validator(value);
  ctx.repos.setupState.patch({ [kind]: { ok: result.ok } });
  return { result };
}
