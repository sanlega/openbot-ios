import type { FastifyInstance } from "fastify";
import { newId, type Bot } from "@openbot/contracts";
import type { CoreContext } from "../../context.js";
import { requireAuth, requireOwner } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { BotConnectorsBody, CreateBotBody, RouteOverrideBody, UpdateBotBody } from "../schemas.js";

/** `bots`: CRUD + `duplicate`; `bots/:id/route`; `bots/:id/why`; `bots/:id/connectors` (plan §4.7). */
export function registerBotRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/bots", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const query = request.query as { includeHidden?: string; includeArchived?: string };
    return {
      bots: ctx.repos.bots.list({
        includeHidden: query.includeHidden === "true",
        includeArchived: query.includeArchived === "true",
      }),
    };
  });

  app.post("/api/bots", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const body = parseOrReject(CreateBotBody, request.body, reply);
    if (!body) return;

    const bot: Bot = {
      id: newId("bot"),
      slug: slugify(body.name),
      name: body.name,
      label: body.label,
      description: body.description,
      avatar: body.avatar,
      pinned: body.pinned,
      hidden: body.hidden,
      isChiefOfStaff: body.isChiefOfStaff,
      // CoS-created Bots go through the `create_bot` MCP tool (plan §4.9,
      // WS4/WS8), not this HTTP endpoint — so every Bot created here is
      // user-initiated by definition.
      createdBy: "user",
      routing: body.routing,
      auth: body.auth,
      permissionPreset: body.permissionPreset,
      computer: body.computer,
      connectors: body.connectors,
      limits: body.limits,
    };
    ctx.repos.bots.create(bot);

    const thread = {
      id: newId("thread"),
      botId: bot.id,
      kind: "dm" as const,
      createdAt: ctx.clock.now().toISOString(),
    };
    ctx.repos.threads.create(thread);

    await ctx.eventBus.publish({ type: "bot.created", botId: bot.id, payload: { bot } });
    reply.code(201);
    return { bot, thread };
  });

  app.get("/api/bots/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const bot = ctx.repos.bots.getById(id);
    if (!bot) return reply.code(404).send({ error: "not_found" });
    return { bot };
  });

  app.patch("/api/bots/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!ctx.repos.bots.getById(id)) return reply.code(404).send({ error: "not_found" });
    const patch = parseOrReject(UpdateBotBody, request.body, reply);
    if (!patch) return;

    ctx.repos.bots.update(id, patch);
    const bot = ctx.repos.bots.getById(id);
    await ctx.eventBus.publish({ type: "bot.updated", botId: id, payload: { patch } });
    return { bot };
  });

  app.delete("/api/bots/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!ctx.repos.bots.getById(id)) return reply.code(404).send({ error: "not_found" });
    ctx.repos.bots.archive(id, ctx.clock.now());
    await ctx.eventBus.publish({ type: "bot.archived", botId: id, payload: {} });
    return { ok: true };
  });

  app.post("/api/bots/:id/duplicate", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const source = ctx.repos.bots.getById(id);
    if (!source) return reply.code(404).send({ error: "not_found" });

    const duplicate: Bot = {
      ...source,
      id: newId("bot"),
      slug: slugify(`${source.name}-copy-${Date.now()}`),
      name: `${source.name} (copy)`,
      isChiefOfStaff: false,
      lastActiveAt: undefined,
      archivedAt: undefined,
      justification: undefined,
    };
    ctx.repos.bots.create(duplicate);
    const thread = {
      id: newId("thread"),
      botId: duplicate.id,
      kind: "dm" as const,
      createdAt: ctx.clock.now().toISOString(),
    };
    ctx.repos.threads.create(thread);
    await ctx.eventBus.publish({
      type: "bot.created",
      botId: duplicate.id,
      payload: { bot: duplicate },
    });
    reply.code(201);
    return { bot: duplicate, thread };
  });

  // Preview or override the engine/model choice (plan §4.7 `bots/:id/route`).
  // Real routing decisions come from `DecisionService.route()` (WS7); until
  // that's wired into `CoreContext`, GET only reports the Bot's own
  // `routing` config, and PUT lets a device override it directly.
  app.get("/api/bots/:id/route", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const bot = ctx.repos.bots.getById(id);
    if (!bot) return reply.code(404).send({ error: "not_found" });
    return {
      routing: bot.routing,
      preview: ctx.decisionService
        ? undefined
        : {
            note: "DecisionService not wired yet (WS7); showing the Bot's configured routing only.",
          },
    };
  });

  app.put("/api/bots/:id/route", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!ctx.repos.bots.getById(id)) return reply.code(404).send({ error: "not_found" });
    const routing = parseOrReject(RouteOverrideBody, request.body, reply);
    if (!routing) return;
    ctx.repos.bots.update(id, { routing });
    await ctx.eventBus.publish({
      type: "route.decided",
      botId: id,
      payload: { routing, override: true },
    });
    return { routing };
  });

  app.get("/api/bots/:id/why", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const bot = ctx.repos.bots.getById(id);
    if (!bot) return reply.code(404).send({ error: "not_found" });
    if (!bot.justification) return { justification: undefined, spawnDecision: undefined };
    const spawnDecision = ctx.repos.decisions.getById(bot.justification.spawnDecisionId);
    return { justification: bot.justification, spawnDecision };
  });

  app.get("/api/bots/:id/connectors", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const { id } = request.params as { id: string };
    const bot = ctx.repos.bots.getById(id);
    if (!bot) return reply.code(404).send({ error: "not_found" });
    return { connectors: bot.connectors };
  });

  app.put("/api/bots/:id/connectors", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!ctx.repos.bots.getById(id)) return reply.code(404).send({ error: "not_found" });
    const body = parseOrReject(BotConnectorsBody, request.body, reply);
    if (!body) return;
    ctx.repos.bots.update(id, { connectors: body.connectors });
    return { connectors: body.connectors };
  });
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "bot"}-${Math.random().toString(36).slice(2, 8)}`;
}
