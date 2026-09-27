import { newId, type Chain } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import type { RoutineRuntime, RoutineRunInput, RoutineRunResult } from "./runtime-spi.js";

export interface SimulatedRuntimeOptions {
  /** When set, dry runs always report these planned actions. */
  plannedActions?: string[];
  /** When set, overrides side-effect detection for dry runs. */
  hasSideEffects?: boolean;
  /** Simulated usage for completed runs. */
  usage?: { usd: number; inputTokens: number; outputTokens: number };
}

/**
 * Minimal `RoutineRuntime` until WS2 lands: creates a chain row, simulates
 * execution synchronously, and records usage on the chain. Dry runs never
 * perform side effects; live runs complete immediately with a stub summary.
 */
export class SimulatedRoutineRuntime implements RoutineRuntime {
  readonly executedRuns: RoutineRunInput[] = [];

  constructor(
    private readonly ctx: CoreContext,
    private readonly options: SimulatedRuntimeOptions = {},
  ) {}

  async executeRun(input: RoutineRunInput): Promise<RoutineRunResult> {
    this.executedRuns.push(input);
    const now = this.ctx.clock.now().toISOString();
    const chain: Chain = {
      id: input.run.chainId,
      origin: "routine",
      mode: input.run.dryRun ? "dry_run" : "live",
      routineRunId: input.run.id,
      status: "active",
      routineDepth: input.routineDepth,
      botMessages: 0,
      turns: 0,
      usd: 0,
      tokens: 0,
      computerSteps: 0,
      wallMin: 0,
      createdAt: now,
    };
    this.ctx.repos.chains.create(chain);

    const perRun = input.routine.limits.perRun;
    const usage = this.options.usage ?? { usd: 0.01, inputTokens: 100, outputTokens: 50 };

    if (usage.usd > perRun.usd || usage.inputTokens + usage.outputTokens > perRun.tokens) {
      this.ctx.repos.chains.setStatus(chain.id, "stopped");
      return {
        status: "capped",
        usage: { usd: usage.usd, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        resultSummary: "per-run cap reached",
      };
    }

    if (input.run.dryRun) {
      const plannedActions =
        this.options.plannedActions ?? [`Would execute routine prompt for ${input.routine.name}`];
      const hasSideEffects =
        this.options.hasSideEffects ??
        plannedActions.some((a) => /send|write|delete|pay|email|post/i.test(a));
      this.ctx.repos.chains.setStatus(chain.id, "done");
      return {
        status: "done",
        usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
        plannedActions,
        hasSideEffects,
        resultSummary: `Dry run: ${plannedActions.length} planned action(s)`,
      };
    }

    this.ctx.repos.chains.incrementCounters(chain.id, {
      turns: 1,
      usd: usage.usd,
      tokens: usage.inputTokens + usage.outputTokens,
    });
    this.ctx.repos.chains.setStatus(chain.id, "done");
    return {
      status: "done",
      usage: { usd: usage.usd, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      resultSummary: `Routine ${input.routine.name} completed`,
    };
  }
}

/** Factory for tests that need a fresh chain id per run. */
export function newChainId(): string {
  return newId("chain");
}
