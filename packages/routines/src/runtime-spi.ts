import type { Routine, RoutineRun, TurnUsage } from "@openbot/contracts";

/**
 * WS2 runtime contract WS12 codes against. When `@openbot/runtime` lands it
 * implements this SPI; until then {@link SimulatedRoutineRuntime} drives tests
 * and milestone scenarios without a real engine mailbox.
 */
export interface RoutineRunInput {
  routine: Routine;
  run: RoutineRun;
  /** Trigger payload, marked UNTRUSTED in the prompt WS2 assembles. */
  triggerPayload?: unknown;
  routineDepth: number;
}

export interface RoutineRunResult {
  status: "done" | "failed" | "capped";
  usage: TurnUsage;
  resultSummary?: string;
  /** Dry-run only: actions that would have been taken. */
  plannedActions?: string[];
  /** Dry-run only: whether any planned action has a side effect. */
  hasSideEffects?: boolean;
}

export interface RoutineRuntime {
  executeRun(input: RoutineRunInput): Promise<RoutineRunResult>;
}
