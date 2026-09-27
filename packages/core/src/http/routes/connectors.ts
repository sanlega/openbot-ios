import type { FastifyInstance } from "fastify";
import type { CoreContext } from "../../context.js";
import { requireAuth, requireLoopback } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { ConnectConnectorBody, OAuthCompleteBody } from "../schemas.js";

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

  /** Loopback OAuth redirect target — completes Composio OAuth and deep-links back to the desktop app. */
  app.get("/api/connectors/oauth/callback", async (request, reply) => {
    if (!requireLoopback(request, reply)) return;
    if (!ctx.connectorService) {
      return reply
        .code(501)
        .send({ error: "not_implemented", reason: "ConnectorProvider not wired yet (WS10)" });
    }

    const query = request.query as { connectionId?: string; state?: string; code?: string };
    if (!query.connectionId || !query.state) {
      return reply
        .code(400)
        .send({ error: "bad_request", reason: "connectionId and state required" });
    }

    try {
      const connection = await ctx.connectorService.completeOAuth(query.connectionId, {
        state: query.state,
        code: query.code,
      });
      reply.type("text/html");
      return oauthSuccessHtml(connection.id, connection.displayName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth failed";
      return reply.code(400).send({ error: "oauth_failed", reason: message });
    }
  });

  /** Authenticated completion path for `openbot://connectors/oauth/complete` deep links (desktop WS6). */
  app.post("/api/connectors/:id/oauth/complete", async (request, reply) => {
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

    const body = parseOrReject(OAuthCompleteBody, request.body ?? {}, reply);
    if (!body) return;

    try {
      const connection = await ctx.connectorService.completeOAuth(id, body);
      return { connection };
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth failed";
      return reply.code(400).send({ error: "oauth_failed", reason: message });
    }
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

function oauthSuccessHtml(connectionId: string, appName: string): string {
  const deepLink = `openbot://connectors/oauth/complete?connectionId=${encodeURIComponent(connectionId)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${appName} connected</title>
  <meta http-equiv="refresh" content="0;url=${deepLink}" />
</head>
<body>
  <p><strong>${appName}</strong> is connected. Returning to OpenBot…</p>
  <p>If the app does not open automatically, <a href="${deepLink}">click here</a>.</p>
</body>
</html>`;
}
