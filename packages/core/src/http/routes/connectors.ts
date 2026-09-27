import type { FastifyInstance } from "fastify";
import type { CoreContext } from "../../context.js";
import { requireAuth } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { ConnectConnectorBody } from "../schemas.js";

/**
 * Connector catalog/connections (plan §4.7 "Connectors"). `listConnections` is
 * a DB read that always works; catalog search, connect, and per-connection
 * triggers delegate to `ConnectorService` when WS10 wires it in.
 */
export function registerConnectorRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/connectors/catalog", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.connectorService) {
      return reply
        .code(501)
        .send({ error: "not_implemented", reason: "ConnectorProvider not wired yet (WS10)" });
    }
    const query = request.query as { q?: string; page?: string; provider?: string };
    const page = query.page ? Number.parseInt(query.page, 10) : undefined;
    const apps = await ctx.connectorService.searchCatalog(query.q ?? "", page, query.provider);
    return { apps };
  });

  app.post("/api/connectors/connect", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.connectorService) {
      return reply
        .code(501)
        .send({ error: "not_implemented", reason: "ConnectorProvider not wired yet (WS10)" });
    }
    const body = parseOrReject(ConnectConnectorBody, request.body, reply);
    if (!body) return;
    const result = await ctx.connectorService.connect(body);
    reply.code(201);
    return result;
  });

  app.get("/api/connectors/connections", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return { connections: ctx.repos.connections.list() };
  });

  app.get("/api/connectors/:id/triggers", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!ctx.connectorService) {
      return reply
        .code(501)
        .send({ error: "not_implemented", reason: "ConnectorProvider not wired yet (WS10)" });
    }
    const { id } = request.params as { id: string };
    if (!ctx.repos.connections.getById(id)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const triggers = await ctx.connectorService.listTriggers(id);
    return { triggers };
  });
}
