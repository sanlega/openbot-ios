import type { FastifyInstance } from "fastify";
import type { CoreContext } from "@openbot/core";
import { createModuleHost } from "@openbot/core";
import { RoutineOrchestrator, type RoutineOrchestratorOptions } from "./orchestrator.js";
import { registerRoutineHookRoutes } from "./routes.js";
import { OpenBotEventTriggerSource } from "./trigger-sources/openbot-events.js";

export interface IntegrateRoutinesResult {
  orchestrator: RoutineOrchestrator;
  openBotEvents: OpenBotEventTriggerSource;
}

/**
 * Wires WS12 into a running harness: webhook routes, orchestrator on
 * `CoreContext`, and the real MCP routine service adapter.
 */
export async function integrateRoutines(
  app: FastifyInstance,
  ctx: CoreContext,
  options: RoutineOrchestratorOptions = {},
): Promise<IntegrateRoutinesResult> {
  const orchestrator = new RoutineOrchestrator(ctx, options);
  ctx.routineOrchestrator = orchestrator;

  const host = createModuleHost(app, ctx);
  registerRoutineHookRoutes(host.app, ctx, orchestrator);

  const openBotEvents = new OpenBotEventTriggerSource(ctx, orchestrator);
  openBotEvents.start();

  await orchestrator.start();

  return { orchestrator, openBotEvents };
}
