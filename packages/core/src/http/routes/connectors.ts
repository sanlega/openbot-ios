import type { FastifyInstance } from "fastify";
import type { CoreContext } from "../../context.js";
import { requireAuth } from "../auth.js";

/**
 * Connector catalog/connections (plan §4.7 "Connectors"). `listConnections` is
 * a DB read that always works; catalog search, connect, and per-connection
 * triggers need a real `ConnectorProvider` (WS10) — deferred with 501 for now.
 */
export function registerConnectorRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/connectors/catalog", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return reply
      .code(501)
      .send({ error: "not_implemented", reason: "ConnectorProvider not wired yet (WS10)" });
  });

  app.post("/api/connectors/connect", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return reply
      .code(501)
      .send({ error: "not_implemented", reason: "ConnectorProvider not wired yet (WS10)" });
  });

  app.get("/api/connectors/connections", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return { connections: ctx.repos.connections.list() };
  });

  app.get("/api/connectors/:id/triggers", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return reply
      .code(501)
      .send({ error: "not_implemented", reason: "ConnectorProvider not wired yet (WS10)" });
  });
}
