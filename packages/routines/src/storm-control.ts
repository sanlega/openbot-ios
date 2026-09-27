import type { CoreContext } from "@openbot/core";
import { O7_GUARDRAILS } from "./defaults.js";

export interface QueuedRunState {
  routineId: string;
  runId: string;
  triggerEventIds: string[];
  lastEventAt: number;
  cooldownUntil: number;
}

/**
 * Per-routine storm control (plan §5 WS12):
 * - Cooldown between runs
 * - At most 1 queued run per routine; later events coalesce (up to 20 event IDs)
 */
export class StormControl {
  private readonly queued = new Map<string, QueuedRunState>();
  private readonly lastRunAt = new Map<string, number>();

  constructor(private readonly ctx: CoreContext) {}

  isInCooldown(routineId: string, cooldownSec: number): boolean {
    const last = this.lastRunAt.get(routineId) ?? 0;
    return this.ctx.clock.now().getTime() - last < cooldownSec * 1000;
  }

  markRunStarted(routineId: string): void {
    this.lastRunAt.set(routineId, this.ctx.clock.now().getTime());
    this.queued.delete(routineId);
  }

  /** Returns existing queued run id if coalescing, or undefined if a new run should be created. */
  coalesceOrQueue(
    routineId: string,
    runId: string,
    triggerEventId: string,
    cooldownSec: number,
  ): { action: "new" } | { action: "coalesce"; runId: string } | { action: "cooldown" } {
    if (this.isInCooldown(routineId, cooldownSec)) {
      const existing = this.queued.get(routineId);
      if (existing) {
        if (existing.triggerEventIds.length < O7_GUARDRAILS.maxQueuedEventsPerRun) {
          existing.triggerEventIds.push(triggerEventId);
        }
        return { action: "coalesce", runId: existing.runId };
      }
      return { action: "cooldown" };
    }

    const existing = this.queued.get(routineId);
    if (existing) {
      if (existing.triggerEventIds.length < O7_GUARDRAILS.maxQueuedEventsPerRun) {
        existing.triggerEventIds.push(triggerEventId);
      }
      return { action: "coalesce", runId: existing.runId };
    }

    this.queued.set(routineId, {
      routineId,
      runId,
      triggerEventIds: [triggerEventId],
      lastEventAt: this.ctx.clock.now().getTime(),
      cooldownUntil: 0,
    });
    return { action: "new" };
  }

  getQueuedEventIds(routineId: string): string[] {
    return this.queued.get(routineId)?.triggerEventIds ?? [];
  }

  clearQueue(routineId: string): void {
    this.queued.delete(routineId);
  }

  /** Restore state after restart from persisted queued runs. */
  restoreQueued(routineId: string, runId: string, triggerEventIds: string[]): void {
    this.queued.set(routineId, {
      routineId,
      runId,
      triggerEventIds,
      lastEventAt: this.ctx.clock.now().getTime(),
      cooldownUntil: 0,
    });
  }
}
