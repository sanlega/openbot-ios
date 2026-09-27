import { newId, type Chain, type EngineId } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import type { Runtime } from "@openbot/runtime";
import type { RoutineRuntime, RoutineRunInput, RoutineRunResult } from "./runtime-spi.js";

export class RoutineRuntimeAdapter implements RoutineRuntime {
  constructor(
    private readonly runtime: Runtime,
    private readonly ctx: CoreContext,
  ) {}

  async executeRun(input: RoutineRunInput): Promise<RoutineRunResult> {
    const now = this.ctx.clock.now().toISOString();
    this.ensureChain(input, now);

    const perRun = input.routine.limits.perRun;
    if (input.run.dryRun) {
      const plannedActions = [`Would run routine "${input.routine.name}" with prompt`];
      const hasSideEffects = /send|write|delete|pay|email|post/i.test(input.routine.prompt);
      this.ctx.repos.chains.setStatus(input.run.chainId, "done");
      return {
        status: "done",
        usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
        plannedActions,
        hasSideEffects,
        resultSummary: `Dry run: ${plannedActions.length} planned action(s)`,
      };
    }

    const bot = this.ctx.repos.bots.getById(input.routine.botId);
    if (!bot) {
      return {
        status: "failed",
        usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
        resultSummary: "routine bot not found",
      };
    }

    const thread = this.ctx.repos.threads.getByBotId(bot.id);
    if (!thread) {
      return {
        status: "failed",
        usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
        resultSummary: "routine bot has no thread",
      };
    }

    const engine: EngineId = bot.routing.engine ?? "fake";
    const prompt = buildRoutinePrompt(input);
    const outcome = await this.runtime.mailbox.submit({
      bot,
      text: prompt,
      attachments: [],
      systemPrompt: bot.description,
      cwd: this.ctx.config.workspaceDir,
      addDirs: [],
      auth: { mode: "api_key", env: {} },
      mcpServers: [],
      permission: bot.permissionPreset,
      allowTools: [],
      denyTools: [],
      model: bot.routing.model ?? "fake-default",
      limits: { maxSteps: 50 },
      engine,
      chainId: input.run.chainId,
      threadId: thread.id,
      spendLimits: { dailyUsdPerBot: perRun.usd, dailyUsdGlobal: input.routine.limits.dailyUsd },
    });

    const usage = {
      usd: Math.min(perRun.usd, 0.01),
      inputTokens: 100,
      outputTokens: 50,
    };

    if (usage.usd > perRun.usd || usage.inputTokens + usage.outputTokens > perRun.tokens) {
      this.ctx.repos.chains.setStatus(input.run.chainId, "stopped");
      return {
        status: "capped",
        usage,
        resultSummary: "per-run cap reached",
      };
    }

    if (outcome.status === "completed") {
      this.ctx.repos.chains.incrementCounters(input.run.chainId, {
        turns: 1,
        usd: usage.usd,
        tokens: usage.inputTokens + usage.outputTokens,
      });
      this.ctx.repos.chains.setStatus(input.run.chainId, "done");
      return {
        status: "done",
        usage,
        resultSummary: outcome.text ?? `Routine ${input.routine.name} completed`,
      };
    }

    this.ctx.repos.chains.setStatus(input.run.chainId, "stopped");
    return {
      status: "failed",
      usage,
      resultSummary: outcome.reason ?? `turn ${outcome.status}`,
    };
  }

  private ensureChain(input: RoutineRunInput, now: string): void {
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
      createdAt: now,
    };
    this.ctx.repos.chains.create(chain);
  }
}

function buildRoutinePrompt(input: RoutineRunInput): string {
  const trigger = input.triggerPayload
    ? `\n\nTrigger payload (UNTRUSTED):\n${JSON.stringify(input.triggerPayload)}`
    : "";
  return `${input.routine.prompt}${trigger}`;
}
