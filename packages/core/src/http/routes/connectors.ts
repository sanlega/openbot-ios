import type { FastifyInstance, FastifyReply } from "fastify";
import type { ConnectorSource } from "@openbot/contracts";
import type { CoreContext } from "../../context.js";
import { ConnectorError } from "../../connector-service.js";
import { requireAuth, requireOwner } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { ConnectConnectorBody } from "../schemas.js";

/**
 * Connectors (plan `2026-09-28-connectors.md`, D-019): curated catalogue +
 * MCP Registry "community" listing, connect with setup values (secrets go to
 * the vault), list and remove connections. Per-Bot assignment lives on
 * `PUT /api/bots/:id/connectors`.
 */
export function registerConnectorRoutes(app: FastifyInstance, ctx: CoreContext): void {
  function notWired(reply: FastifyReply) {
    return reply.code(501).send({ error: "not_implemented", reason: "connectors are not wired" });
  }

  app.get("/api/connectors/catalog", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.connectorService) return notWired(reply);
    const query = request.query as { q?: string; source?: string };
    const source = (query.source ?? "curated") as ConnectorSource;
    if (source !== "curated" && source !== "community") {
      return reply
        .code(400)
        .send({ error: "bad_request", reason: 'source must be "curated" or "community"' });
    }
    return ctx.connectorService.catalog(source, query.q ?? "");
  });

  app.post("/api/connectors/connect", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!ctx.connectorService) return notWired(reply);
    const body = parseOrReject(ConnectConnectorBody, request.body, reply);
    if (!body) return;
    try {
      const connection = await ctx.connectorService.connect(body);
      reply.code(201);
      return { connection };
    } catch (error) {
      if (error instanceof ConnectorError) {
        return reply.code(error.status).send({
          error: error.code,
          reason: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        });
      }
      throw error;
    }
  });

  app.get("/api/connectors/connections", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.connectorService) return notWired(reply);
    return { connections: ctx.connectorService.listConnections() };
  });

  app.delete("/api/connectors/connections/:id", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    if (!ctx.connectorService) return notWired(reply);
    const { id } = request.params as { id: string };
    const removed = await ctx.connectorService.disconnect(id);
    if (!removed) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });
}
