import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  newId,
  type Routine,
  type RoutineRun,
  type RoutineRunCause,
  type TriggerEvent,
  type TriggerSourceEvent,
} from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import { checkRunCaps, recordRunSpend, recordRunStarted } from "./caps.js";
import { O7_GUARDRAILS } from "./defaults.js";
import { hashPayload, matchTriggerEvent } from "./matcher.js";
import type { RoutineRuntime } from "./runtime-spi.js";
import { RoutineScheduler } from "./scheduler.js";
import { SimulatedRoutineRuntime } from "./simulated-runtime.js";
import { StormControl } from "./storm-control.js";

export interface RoutineOrchestratorOptions {
  runtime?: RoutineRuntime;
}

/**
 * WS12 orchestrator: scheduler, trigger matching, storm control, run lifecycle,
 * dry-run reports, and `routine_live` approval flow.
 */
export class RoutineOrchestrator {
  readonly scheduler: RoutineScheduler;
  readonly storm: StormControl;
  private readonly runtime: RoutineRuntime;
  private started = false;
  private readonly pendingExecutions = new Map<string, number>();
  private readonly coalesceDelayMs = 100;

  constructor(
    readonly ctx: CoreContext,
    options: RoutineOrchestratorOptions = {},
  ) {
    this.storm = new StormControl(ctx);
    this.runtime = options.runtime ?? new SimulatedRoutineRuntime(ctx);
    this.scheduler = new RoutineScheduler(ctx, (routineId) => {
      void this.queueRun(routineId, "schedule");
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.restoreQueuedRuns();
    this.scheduler.start(this.ctx.repos.routines.list());
  }

  async stop(): Promise<void> {
    this.scheduler.stopAll();
    this.started = false;
  }

  private restoreQueuedRuns(): void {
    for (const routine of this.ctx.repos.routines.list()) {
      const queued = this.ctx.repos.routineRuns
        .listByRoutine(routine.id)
        .find((run) => run.status === "queued");
      if (queued) {
        this.storm.restoreQueued(routine.id, queued.id, queued.triggerEventIds);
      }
    }
  }

  async queueRun(
    routineId: string,
    cause: RoutineRunCause,
    opts: { dryRun?: boolean; triggerEventIds?: string[]; triggerPayload?: unknown; test?: boolean } = {},
  ): Promise<RoutineRun | { skipped: true; reason: string }> {
    const routine = this.ctx.repos.routines.getById(routineId);
    if (!routine) return { skipped: true, reason: "routine not found" };
    if (!routine.enabled) return { skipped: true, reason: "routine disabled" };

    const isFirstRun = this.ctx.repos.routineRuns.listByRoutine(routineId).length === 0;
    const dryRun = opts.dryRun ?? (isFirstRun ? true : cause === "manual" ? false : !routine.liveApproved);
    const effectiveCause = opts.test ? "test" : cause;

    const capCheck = checkRunCaps(this.ctx, routine, dryRun);
    if (!capCheck.allowed) {
      const run = await this.createSkippedRun(routine, effectiveCause, dryRun, capCheck.reason, opts.triggerEventIds);
      return run;
    }

    const runId = newId("routineRun");
    if (cause === "event") {
      const eventId = opts.triggerEventIds?.[0] ?? "";
      const coalesce = this.storm.coalesceOrQueue(
        routineId,
        runId,
        eventId,
        routine.limits.cooldownSec,
      );
      if (coalesce.action === "coalesce") {
        const existing = this.ctx.repos.routineRuns.getById(coalesce.runId);
        if (existing && eventId) {
          const ids = [...existing.triggerEventIds, eventId].slice(
            0,
            O7_GUARDRAILS.maxQueuedEventsPerRun,
          );
          this.ctx.repos.routineRuns.update(coalesce.runId, { triggerEventIds: ids });
        }
        return existing ?? { skipped: true, reason: "coalesce target missing" };
      }
      if (coalesce.action === "cooldown") {
        return { skipped: true, reason: "cooldown" };
      }
    }

    const chainId = newId("chain");
    const run: RoutineRun = {
      id: runId,
      routineId,
      chainId,
      cause: effectiveCause,
      triggerEventIds: opts.triggerEventIds ?? [],
      dryRun,
      status: "queued",
      usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
    };
    this.ctx.repos.routineRuns.create(run);

    await this.ctx.eventBus.publish({
      type: "routine.run_queued",
      botId: routine.botId,
      chainId,
      payload: { routineId, runId, dryRun, cause: effectiveCause },
    });

    if (cause === "event") {
      this.scheduleExecution(routine, run, opts.triggerPayload);
    } else {
      void this.executeRun(routine, run, opts.triggerPayload);
    }
    return run;
  }

  private async createSkippedRun(
    routine: Routine,
    cause: RoutineRunCause,
    dryRun: boolean,
    reason: string,
    triggerEventIds?: string[],
  ): Promise<RoutineRun> {
    const run: RoutineRun = {
      id: newId("routineRun"),
      routineId: routine.id,
      chainId: newId("chain"),
      cause,
      triggerEventIds: triggerEventIds ?? [],
      dryRun,
      status: "skipped",
      skipReason: reason,
      usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
      endedAt: this.ctx.clock.now().toISOString(),
    };
    this.ctx.repos.routineRuns.create(run);
    await this.ctx.eventBus.publish({
      type: "routine.run_skipped",
      botId: routine.botId,
      payload: { routineId: routine.id, runId: run.id, reason },
    });
    return run;
  }

  private scheduleExecution(
    routine: Routine,
    run: RoutineRun,
    triggerPayload?: unknown,
  ): void {
    const existing = this.pendingExecutions.get(routine.id);
    if (existing !== undefined && "clearTimeout" in globalThis) {
      clearTimeout(existing);
    }

    const clock = this.ctx.clock;
    const fire = (): void => {
      this.pendingExecutions.delete(routine.id);
      const latest = this.ctx.repos.routineRuns.getById(run.id);
      if (!latest || latest.status !== "queued") return;
      void this.executeRun(routine, latest, triggerPayload);
    };

    const fakeClock = clock as { setTimeout?: (fn: () => void, ms: number) => number };
    if (typeof fakeClock.setTimeout === "function") {
      const timerId = fakeClock.setTimeout(fire, this.coalesceDelayMs);
      this.pendingExecutions.set(routine.id, timerId);
    } else {
      setTimeout(fire, this.coalesceDelayMs);
    }
  }

  async executeRun(routine: Routine, run: RoutineRun, triggerPayload?: unknown): Promise<void> {
    const routineDepth = this.computeRoutineDepth(routine.id);
    if (routineDepth > O7_GUARDRAILS.maxRoutineDepth) {
      this.completeRun(routine, run, "skipped", "routine depth exceeded");
      return;
    }

    this.ctx.repos.routineRuns.update(run.id, {
      status: "running",
      startedAt: this.ctx.clock.now().toISOString(),
    });
    recordRunStarted(this.ctx, routine.id);
    this.storm.markRunStarted(routine.id);

    await this.ctx.eventBus.publish({
      type: "routine.run_started",
      botId: routine.botId,
      chainId: run.chainId,
      payload: { routineId: routine.id, runId: run.id, dryRun: run.dryRun },
    });

    try {
      const result = await this.runtime.executeRun({
        routine,
        run,
        triggerPayload,
        routineDepth,
      });

      if (result.status === "capped") {
        await this.completeRun(routine, run, "capped", result.resultSummary ?? "capped", result);
        this.maybeAutoPause(routine, "capped");
        return;
      }

      if (run.dryRun && result.hasSideEffects && !routine.liveApproved) {
        await this.requestLiveApproval(routine, run, result.plannedActions ?? []);
      }

      if (!run.dryRun && result.status === "done") {
        recordRunSpend(this.ctx, routine, result.usage.usd);
      }

      await this.completeRun(
        routine,
        run,
        result.status === "done" ? "done" : "failed",
        result.resultSummary,
        result,
      );

      if (result.status === "failed") {
        this.maybeAutoPause(routine, "failed");
      } else {
        this.ctx.repos.routines.update(routine.id, { consecutiveFailures: 0 });
      }

      // Auto-approve live if dry run had no side effects
      if (run.dryRun && result.status === "done" && !result.hasSideEffects) {
        this.ctx.repos.routines.update(routine.id, { liveApproved: true });
      }
    } catch (error) {
      await this.completeRun(routine, run, "failed", String(error));
      this.maybeAutoPause(routine, "failed");
    }

    this.ctx.repos.routines.update(routine.id, {
      lastRunAt: this.ctx.clock.now().toISOString(),
    });
  }

  private computeRoutineDepth(routineId: string): number {
    // Depth 0 for direct triggers; depth increases when triggered by another routine's events.
    const recentEvents = this.ctx.repos.triggerEvents.listByRoutine(routineId);
    for (const evt of recentEvents) {
      const payload = evt.payloadRef;
      if (payload.includes("routine.run_completed")) return 1;
    }
    return 0;
  }

  private async requestLiveApproval(
    routine: Routine,
    run: RoutineRun,
    plannedActions: string[],
  ): Promise<void> {
    const approvalId = newId("approval");
    const now = this.ctx.clock.now();
    this.ctx.repos.approvals.create({
      id: approvalId,
      kind: "routine_live",
      botId: routine.botId,
      chainId: run.chainId,
      summary: `Enable live runs for routine "${routine.name}"?`,
      detail: `Dry run planned side-effect actions:\n${plannedActions.join("\n")}`,
      status: "pending",
      resolution: undefined,
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
    });
    await this.ctx.eventBus.publish({
      type: "approval.requested",
      botId: routine.botId,
      chainId: run.chainId,
      payload: { id: approvalId, kind: "routine_live", routineId: routine.id },
    });
  }

  private async completeRun(
    routine: Routine,
    run: RoutineRun,
    status: RoutineRun["status"],
    resultSummary?: string,
    result?: { usage?: RoutineRun["usage"]; plannedActions?: string[] },
  ): Promise<void> {
    const patch: Partial<RoutineRun> = {
      status,
      resultSummary,
      endedAt: this.ctx.clock.now().toISOString(),
    };
    if (result?.usage) patch.usage = result.usage;
    if (result?.plannedActions) patch.plannedActions = result.plannedActions;

    this.ctx.repos.routineRuns.update(run.id, patch);

    if (run.dryRun && result?.plannedActions) {
      await this.writeDryRunReport(routine.id, run.id, result.plannedActions);
    }

    const eventType =
      status === "skipped" ? "routine.run_skipped" : "routine.run_completed";
    await this.ctx.eventBus.publish({
      type: eventType,
      botId: routine.botId,
      chainId: run.chainId,
      payload: {
        routineId: routine.id,
        runId: run.id,
        status,
        dryRun: run.dryRun,
        usage: result?.usage,
      },
    });
  }

  private async writeDryRunReport(
    routineId: string,
    runId: string,
    plannedActions: string[],
  ): Promise<void> {
    const dir = join(this.ctx.config.routinesDir, routineId, "runs");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${runId}.json`),
      JSON.stringify({ runId, plannedActions, generatedAt: this.ctx.clock.now().toISOString() }, null, 2),
    );
  }

  private maybeAutoPause(routine: Routine, reason: "failed" | "capped"): void {
    const failures =
      reason === "failed" ? routine.consecutiveFailures + 1 : routine.consecutiveFailures;
    this.ctx.repos.routines.update(routine.id, { consecutiveFailures: failures });
    if (failures >= O7_GUARDRAILS.maxConsecutiveFailures) {
      this.ctx.repos.routines.update(routine.id, {
        enabled: false,
        pausedReason: `auto-paused after ${failures} consecutive ${reason} runs`,
      });
      void this.ctx.eventBus.publish({
        type: "routine.paused",
        botId: routine.botId,
        payload: { id: routine.id, reason: "consecutive_failures" },
      });
    }
  }

  async handleTriggerEvent(routine: Routine, event: TriggerSourceEvent): Promise<void> {
    if (routine.trigger.type !== "event") return;

    const existing = this.ctx.repos.triggerEvents.findByPayloadHash(routine.id, event.payloadHash);
    if (existing) return;

    const payloadRef = await this.storePayload(routine.id, event);
    const tev: TriggerEvent = {
      id: newId("triggerEvent"),
      source: event.source,
      routineId: routine.id,
      payloadHash: event.payloadHash,
      payloadRef,
      matched: false,
      receivedAt: event.receivedAt,
    };

    const match = await matchTriggerEvent(routine, event, this.ctx.decisionService);
    tev.matched = match.matched;
    tev.matchDecisionId = match.matchDecisionId;
    this.ctx.repos.triggerEvents.create(tev);

    await this.ctx.eventBus.publish({
      type: "trigger.received",
      botId: routine.botId,
      payload: { triggerEventId: tev.id, routineId: routine.id, matched: match.matched },
    });

    if (match.matched) {
      if (match.matchDecisionId) {
        await this.ctx.eventBus.publish({
          type: "gate.decided",
          botId: routine.botId,
          payload: {
            gate: "trigger",
            allowed: true,
            decisionId: match.matchDecisionId,
          },
        });
      }
      await this.queueRun(routine.id, "event", {
        triggerEventIds: [tev.id],
        triggerPayload: event.payload,
      });
    } else if (match.matchDecisionId) {
      await this.ctx.eventBus.publish({
        type: "gate.decided",
        botId: routine.botId,
        payload: {
          gate: "trigger",
          allowed: false,
          decisionId: match.matchDecisionId,
          reason: match.reason,
        },
      });
    }
  }

  private async storePayload(routineId: string, event: TriggerSourceEvent): Promise<string> {
    const dir = join(this.ctx.config.routinesDir, routineId, "events");
    await mkdir(dir, { recursive: true });
    const ref = join(dir, `${event.id}.json`);
    await writeFile(ref, JSON.stringify(event.payload));
    return ref;
  }

  async handleWebhook(routineId: string, payload: unknown, secret: string): Promise<{ ok: boolean; reason?: string }> {
    const routine = this.ctx.repos.routines.getById(routineId);
    if (!routine) return { ok: false, reason: "not_found" };
    if (routine.trigger.type !== "event" || routine.trigger.source !== "webhook") {
      return { ok: false, reason: "not a webhook routine" };
    }

    const storedSecret = await this.ctx.vault.get(`routine.${routineId}.hookSecret`);
    if (!storedSecret || storedSecret !== secret) {
      return { ok: false, reason: "invalid_secret" };
    }

    const event: TriggerSourceEvent = {
      id: newId("triggerEvent"),
      source: "webhook",
      payloadHash: hashPayload(payload),
      payload,
      receivedAt: this.ctx.clock.now().toISOString(),
    };
    await this.handleTriggerEvent(routine, event);
    return { ok: true };
  }

  onRoutineCreated(routine: Routine): void {
    if (routine.trigger.type === "schedule") {
      this.scheduler.scheduleRoutine(routine);
    }
    if (routine.trigger.type === "event" && routine.trigger.source === "webhook") {
      void this.ensureWebhookSecret(routine.id);
    }
    // First run is always a dry run
    void this.queueRun(routine.id, "manual", { dryRun: true });
  }

  onRoutineUpdated(routine: Routine): void {
    this.scheduler.unschedule(routine.id);
    if (routine.enabled && routine.trigger.type === "schedule") {
      this.scheduler.scheduleRoutine(routine);
    }
  }

  onRoutineDeleted(routineId: string): void {
    this.scheduler.unschedule(routineId);
  }

  private async ensureWebhookSecret(routineId: string): Promise<string> {
    const key = `routine.${routineId}.hookSecret`;
    const existing = await this.ctx.vault.get(key);
    if (existing) return existing;
    const secret = newId("triggerEvent").replace("tev_", "");
    await this.ctx.vault.set(key, secret);
    return secret;
  }

  async getWebhookSecret(routineId: string): Promise<string | undefined> {
    return this.ctx.vault.get(`routine.${routineId}.hookSecret`);
  }
}
