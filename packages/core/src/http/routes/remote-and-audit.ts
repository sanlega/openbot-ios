import type { FastifyInstance } from "fastify";
import { computeBindHostFlags, type CoreContext } from "../../context.js";
import { requireAuth, requireOwner } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { CloudflareTunnelBody, DecisionsQuery } from "../schemas.js";

/**
 * Remote status (WS11 enables Tailscale serve / Cloudflare tunnel), plus
 * usage/audit/decisions read endpoints (plan §4.7).
 */
export function registerRemoteAndAuditRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/remote/status", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const flags = computeBindHostFlags(ctx);
    const tailscale = ctx.remote ? await ctx.remote.tailscale.status() : undefined;
    const cloudflare = ctx.remote ? ctx.remote.cloudflare.status() : undefined;
    return { ...flags, setup: ctx.repos.setupState.get(), tailscale, cloudflare };
  });

  app.post("/api/remote/tailscale/enable", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!ctx.remote) {
      return reply.code(501).send({ error: "not_implemented", reason: "remote module not wired" });
    }
    const result = await ctx.remote.tailscale.enable(ctx.config.port);
    ctx.repos.setupState.patch({ tailscale: { ok: result.ok } });
    if (result.ok) {
      await ctx.eventBus.publish({
        type: "remote.status",
        payload: {
          tailscale: { enabled: true, urls: result.urls },
          cloudflare: { enabled: false },
        },
      });
    }
    return { result };
  });

  app.post("/api/remote/tailscale/disable", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (ctx.remote) await ctx.remote.tailscale.disable();
    ctx.repos.setupState.patch({ tailscale: { ok: false } });
    await ctx.eventBus.publish({
      type: "remote.status",
      payload: { tailscale: { enabled: false }, cloudflare: { enabled: false } },
    });
    return { ok: true };
  });

  app.post("/api/remote/cloudflare", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const body = parseOrReject(CloudflareTunnelBody, request.body, reply);
    if (!body) return;
    if (!ctx.remote) {
      return reply.code(501).send({ error: "not_implemented", reason: "remote module not wired" });
    }
    const result = await ctx.remote.cloudflare.start(body.token);
    ctx.repos.setupState.patch({ cloudflare: { ok: result.ok } });
    if (result.ok) {
      await ctx.eventBus.publish({
        type: "remote.status",
        payload: {
          tailscale: { enabled: false },
          cloudflare: {
            enabled: true,
            hostname: result.hostname,
            accessWarning: result.accessWarning,
          },
        },
      });
    }
    return { result };
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
