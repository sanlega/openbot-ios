import type { CoreContext } from "@openbot/core";
import type { NotifyGate, SpawnGate, CapCounterService } from "@openbot/cos";
import type { Runtime } from "@openbot/runtime";
import type { RoutineOrchestrator } from "@openbot/routines";
import { McpCosServiceAdapter } from "./cos-service.js";
import { McpComputerServiceAdapter } from "./computer-service.js";
import { ConnectorMcpComposer } from "./connector-composer.js";
import { createFakeMcpServices } from "./fakes.js";
import type { McpToolServices } from "./interfaces.js";
import { McpRoutineServiceAdapter } from "./routine-service.js";
import { McpRuntimeServiceAdapter } from "./runtime-service.js";

export interface McpServiceDeps {
  runtime: Runtime;
  spawnGate: SpawnGate;
  notifyGate: NotifyGate;
  caps: CapCounterService;
  orchestrator: RoutineOrchestrator;
}

export function createMcpServices(ctx: CoreContext, deps: McpServiceDeps): McpToolServices {
  return {
    runtime: new McpRuntimeServiceAdapter(ctx, deps.runtime),
    cos: new McpCosServiceAdapter(ctx, {
      spawnGate: deps.spawnGate,
      notifyGate: deps.notifyGate,
      runtime: deps.runtime,
      caps: deps.caps,
    }),
    computer: new McpComputerServiceAdapter(ctx, deps.runtime),
    routines: new McpRoutineServiceAdapter(ctx, deps.orchestrator),
    connectors: new ConnectorMcpComposer(ctx),
  };
}

export function createMcpServicesForTests(
  ctx: CoreContext,
  orchestrator?: RoutineOrchestrator,
): McpToolServices {
  const fakes = createFakeMcpServices();
  if (!orchestrator) return fakes;
  return {
    ...fakes,
    routines: new McpRoutineServiceAdapter(ctx, orchestrator),
  };
}
