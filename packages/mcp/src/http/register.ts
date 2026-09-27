import type { FastifyInstance } from "fastify";
import type { CoreContext } from "@openbot/core";
import type { SessionTokenService } from "../session-token.js";
import { createToolRouter } from "../handlers.js";
import type { McpToolServices } from "../services/interfaces.js";
import type { SessionContext } from "../types.js";

const SESSION_HEADER = "x-openbot-session";

export interface InternalToolsOptions {
  tokens: SessionTokenService;
  services: McpToolServices;
}

/**
 * Registers `POST /internal/tools/:name` (plan §4.7). Authenticated with a
 * per-turn `X-OpenBot-Session` token — loopback only until remote access lands.
 */
export function registerInternalToolRoutes(
  app: FastifyInstance,
  ctx: CoreContext,
  options: InternalToolsOptions,
): void {
  const router = createToolRouter(ctx, options.services);

  app.post<{ Params: { name: string }; Body: unknown }>(
    "/internal/tools/:name",
    async (request, reply) => {
      const token = request.headers[SESSION_HEADER];
      if (typeof token !== "string" || token.length === 0) {
        return reply.status(401).send({ error: "missing session token" });
      }

      const claims = options.tokens.verify(token);
      if (!claims) {
        return reply.status(401).send({ error: "invalid or expired session token" });
      }

      const bot = ctx.repos.bots.getById(claims.botId);
      if (!bot) {
        return reply.status(401).send({ error: "unknown bot for session" });
      }

      const session: SessionContext = {
        ...claims,
        bot,
        isChiefOfStaff: bot.isChiefOfStaff,
      };

      const result = await router.dispatch(request.params.name, request.body, session);
      return reply.status(200).send(result);
    },
  );
}
