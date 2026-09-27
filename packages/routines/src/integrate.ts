import type { FastifyInstance } from "fastify";
import type { CoreContext } from "@openbot/core";
import { createModuleHost } from "@openbot/core";
import { RoutineOrchestrator, type RoutineOrchestratorOptions } from "./orchestrator.js";
import { registerRoutineHookRoutes } from "./routes.js";
import { OpenBotEventTriggerSource } from "./trigger-sources/openbot-events.js";
import { FileWatchTriggerSource } from "./trigger-sources/file-watch.js";

export interface IntegrateRoutinesResult {
  orchestrator: RoutineOrchestrator;
  openBotEvents: OpenBotEventTriggerSource;
  fileWatch: FileWatchTriggerSource;
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

  const fileWatch = new FileWatchTriggerSource(ctx, orchestrator);
  orchestrator.attachTriggerSources({ fileWatch });
  fileWatch.start();

  await orchestrator.start();

  return { orchestrator, openBotEvents, fileWatch };
}
