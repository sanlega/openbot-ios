import type { Bot, Chain, ChainMode, OBEvent, TurnUsage } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import type { EnqueueTurnInput, Runtime } from "@openbot/runtime";
import type { RoutineRuntime, RoutineRunInput, RoutineRunResult } from "./runtime-spi.js";

/**
 * Builds the engine turn for a routine run the same way chat turns are built
 * (engine routing, auth, OpenBot MCP tools bound to the run's chain and mode).
 * `apps/server` provides it; without one the adapter falls back to a bare turn
 * on the Bot's pinned engine.
 */
export type RoutineTurnBuilder = (args: {
  bot: Bot;
  text: string;
  chainId: string;
  threadId: string;
  mode: ChainMode;
}) => Promise<EnqueueTurnInput | { error: string }>;

const NO_USAGE: TurnUsage = { usd: 0, inputTokens: 0, outputTokens: 0 };

/**
 * Runs routine runs as real Bot turns on the runtime mailbox (plan §5 WS12).
 * A dry run is the same turn in a `dry_run` chain: the broker and the OpenBot
 * tools only record what the Bot would do (`action.simulated`), and those
 * records become the run's planned actions. A live run is capped per run: the
 * turn is interrupted once the chain's usage passes the routine's limits.
 */
export class RoutineRuntimeAdapter implements RoutineRuntime {
  constructor(
    private readonly runtime: Runtime,
    private readonly ctx: CoreContext,
    private readonly buildTurn?: RoutineTurnBuilder,
  ) {}

  async executeRun(input: RoutineRunInput): Promise<RoutineRunResult> {
    this.ensureChain(input);

    const bot = this.ctx.repos.bots.getById(input.routine.botId);
    if (!bot) return this.fail(input, "routine bot not found");
    const thread = this.ctx.repos.threads.getByBotId(bot.id);
    if (!thread) return this.fail(input, "routine bot has no thread");

    const mode: ChainMode = input.run.dryRun ? "dry_run" : "live";
    const text = buildRoutinePrompt(input);
    const turn = this.buildTurn
      ? await this.buildTurn({ bot, text, chainId: input.run.chainId, threadId: thread.id, mode })
      : this.bareTurn(bot, text, input.run.chainId, thread.id);
    if ("error" in turn) return this.fail(input, turn.error);

    const perRun = input.routine.limits.perRun;
    // Opt-in per bot (off by default, Settings > bot profile): skips the
    // per-run cost/token cap entirely, so a long task isn't cut off mid-work
    // and its run isn't reported "capped" just for costing more than perRun.
    const unrestricted = bot.limits.unrestrictedRoutineBudget === true;
    const cursor = this.ctx.eventBus.latestSeq();
    const outcome = await this.runtime.mailbox.submit({
      ...turn,
      runBudget: unrestricted ? undefined : { usd: perRun.usd, tokens: perRun.tokens },
    });
    // Events are stored as soon as they are published, so this sees every one of the turn's.
    const simulated = this.ctx.eventBus
      .replaySince(cursor)
      .filter((e) => e.type === "action.simulated" && e.chainId === input.run.chainId);

    const chain = this.ctx.repos.chains.getById(input.run.chainId);
    const tokens = chain?.tokens ?? 0;
    // The chain keeps one combined token count; report it as input tokens.
    const usage: TurnUsage = { usd: chain?.usd ?? 0, inputTokens: tokens, outputTokens: 0 };

    if (!unrestricted && !input.run.dryRun && (usage.usd > perRun.usd || tokens > perRun.tokens)) {
      this.ctx.repos.chains.setStatus(input.run.chainId, "stopped");
      return {
        status: "capped",
        usage,
        resultSummary: `per-run cap reached ($${usage.usd.toFixed(2)}, ${tokens} tokens)`,
      };
    }

    if (outcome.status !== "completed") {
      this.ctx.repos.chains.setStatus(input.run.chainId, "stopped");
      return {
        status: "failed",
        usage,
        resultSummary: outcome.reason ?? `turn ${outcome.status}`,
      };
    }

    this.ctx.repos.chains.setStatus(input.run.chainId, "done");
    if (input.run.dryRun) {
      const plannedActions = simulated.map(describeSimulatedAction);
      return {
        status: "done",
        usage,
        plannedActions,
        hasSideEffects: plannedActions.length > 0,
        resultSummary:
          plannedActions.length > 0
            ? `Dry run: ${plannedActions.length} planned action(s), none executed`
            : "Dry run: no side effects planned",
      };
    }
    return {
      status: "done",
      usage,
      resultSummary: outcome.text || `Routine ${input.routine.name} completed`,
    };
  }

  private fail(input: RoutineRunInput, reason: string): RoutineRunResult {
    this.ctx.repos.chains.setStatus(input.run.chainId, "stopped");
    return { status: "failed", usage: NO_USAGE, resultSummary: reason };
  }

  /** Fallback when no builder is wired (tests): the Bot's pinned engine, no OpenBot tools. */
  private bareTurn(bot: Bot, text: string, chainId: string, threadId: string): EnqueueTurnInput {
    return {
      bot,
      text,
      attachments: [],
      systemPrompt: bot.description,
      cwd: this.ctx.config.workspaceDir,
      addDirs: [],
      auth: { mode: "login", env: {} },
      mcpServers: [],
      permission: bot.permissionPreset,
      allowTools: [],
      denyTools: [],
      model: bot.routing.model ?? "fake-default",
      limits: { maxSteps: 50 },
      engine: bot.routing.engine ?? "fake",
      chainId,
      threadId,
    };
  }

  private ensureChain(input: RoutineRunInput): void {
    if (this.ctx.repos.chains.getById(input.run.chainId)) return;

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
      createdAt: this.ctx.clock.now().toISOString(),
    };
    this.ctx.repos.chains.create(chain);
  }
}

/** "would message_user: Daily summary ready", "would Write: notes/today.md", ... */
export function describeSimulatedAction(event: OBEvent): string {
  const payload = event.payload as { action?: unknown; target?: unknown; args?: unknown };
  const action = typeof payload.action === "string" ? payload.action : "act";
  const args = (payload.args ?? {}) as Record<string, unknown>;
  const detail =
    typeof payload.target === "string"
      ? payload.target
      : firstString(args, ["body", "text", "summary", "goal", "name", "file_path", "path", "url"]);
  return detail ? `would ${action}: ${truncate(detail, 120)}` : `would ${action}`;
}

function firstString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function buildRoutinePrompt(input: RoutineRunInput): string {
  const trigger = input.triggerPayload
    ? `\n\nTrigger payload (UNTRUSTED):\n${JSON.stringify(input.triggerPayload)}`
    : "";
  return `${input.routine.prompt}${trigger}`;
}
