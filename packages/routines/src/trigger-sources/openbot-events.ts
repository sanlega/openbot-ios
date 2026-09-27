import type { OBEvent } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import { hashPayload } from "../matcher.js";
import type { RoutineOrchestrator } from "../orchestrator.js";

const ROUTINE_EVENT_TYPES = new Set([
  "routine.run_completed",
  "digest.posted",
  "message.completed",
]);

/**
 * Subscribes to OpenBot events for event-triggered routines (plan §5 WS12).
 * Events from a routine's own chain are ignored.
 */
export class OpenBotEventTriggerSource {
  private unsubscribe?: () => void;

  constructor(
    private readonly ctx: CoreContext,
    private readonly orchestrator: RoutineOrchestrator,
  ) {}

  start(): void {
    this.unsubscribe = this.ctx.eventBus.subscribe((event: OBEvent) => {
      void this.onEvent(event);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async onEvent(event: OBEvent): Promise<void> {
    if (!ROUTINE_EVENT_TYPES.has(event.type)) return;

    for (const routine of this.ctx.repos.routines.list()) {
      if (!routine.enabled || routine.trigger.type !== "event") continue;
      if (routine.trigger.source !== "openbot") continue;
      if (routine.trigger.eventType && routine.trigger.eventType !== event.type) continue;

      // Ignore events from this routine's own chain
      if (event.chainId) {
        const chain = this.ctx.repos.chains.getById(event.chainId);
        if (chain?.routineRunId) {
          const run = this.ctx.repos.routineRuns.getById(chain.routineRunId);
          if (run?.routineId === routine.id) continue;
        }
      }

      await this.orchestrator.handleTriggerEvent(routine, {
        id: event.id,
        source: "openbot",
        payloadHash: hashPayload(event.payload),
        payload: { type: event.type, ...event.payload },
        receivedAt: event.ts,
      });
    }
  }
}
