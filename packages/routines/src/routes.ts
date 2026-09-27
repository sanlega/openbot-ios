import type { FastifyInstance } from "fastify";
import type { CoreContext } from "@openbot/core";
import type { RoutineOrchestrator } from "./orchestrator.js";
import { WEBHOOK_RATE_LIMIT_PER_MIN } from "./defaults.js";

const webhookCounts = new Map<string, { windowStart: number; count: number }>();

/**
 * WS12 routes registered through the module host (plan §4.7):
 * `POST /hooks/:routineId` with `X-OpenBot-Hook-Secret`, rate-limited.
 */
export function registerRoutineHookRoutes(
  app: FastifyInstance,
  ctx: CoreContext,
  orchestrator: RoutineOrchestrator,
): void {
  app.post("/hooks/:routineId", async (request, reply) => {
    const { routineId } = request.params as { routineId: string };
    const secret = request.headers["x-openbot-hook-secret"];
    if (typeof secret !== "string") {
      return reply.code(401).send({ error: "missing_secret" });
    }

    if (!checkWebhookRateLimit(routineId, ctx.clock.now().getTime())) {
      return reply.code(429).send({ error: "rate_limited" });
    }

    const result = await orchestrator.handleWebhook(routineId, request.body, secret);
    if (!result.ok) {
      const code = result.reason === "not_found" ? 404 : result.reason === "invalid_secret" ? 401 : 400;
      return reply.code(code).send({ error: result.reason });
    }
    return { ok: true };
  });
}

function checkWebhookRateLimit(routineId: string, nowMs: number): boolean {
  const windowMs = 60_000;
  const entry = webhookCounts.get(routineId);
  if (!entry || nowMs - entry.windowStart >= windowMs) {
    webhookCounts.set(routineId, { windowStart: nowMs, count: 1 });
    return true;
  }
  if (entry.count >= WEBHOOK_RATE_LIMIT_PER_MIN) return false;
  entry.count += 1;
  return true;
}
