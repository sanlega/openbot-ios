import { Cron } from "croner";
import type { Clock } from "@openbot/contracts";
import type { Routine, RoutineScheduleTrigger } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import { O7_GUARDRAILS } from "./defaults.js";

export type ScheduleCallback = (routineId: string, cause: "schedule") => void;

interface FakeClockLike extends Clock {
  setTimeout(fn: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

function isFakeClock(clock: Clock): clock is FakeClockLike {
  return typeof (clock as FakeClockLike).setTimeout === "function";
}

/**
 * Cron scheduler using `croner` in the user's timezone (plan §5 WS12).
 * When wired to a {@link FakeClock}, schedules via fake timers so tests are
 * deterministic. Missed runs follow `catchUp: 'none'|'last'`.
 */
export class RoutineScheduler {
  private readonly jobs = new Map<string, { stop: () => void }>();
  private readonly firedOnce = new Set<string>();

  constructor(
    private readonly ctx: CoreContext,
    private readonly onFire: ScheduleCallback,
  ) {}

  start(routines: Routine[]): void {
    this.stopAll();
    for (const routine of routines) {
      if (!routine.enabled || routine.trigger.type !== "schedule") continue;
      this.scheduleRoutine(routine);
    }
  }

  scheduleRoutine(routine: Routine): void {
    if (routine.trigger.type !== "schedule") return;
    const trigger = routine.trigger;
    this.unschedule(routine.id);

    if (trigger.at) {
      this.scheduleOnce(routine.id, trigger);
      return;
    }

    if (!trigger.cron) return;

    if (isFakeClock(this.ctx.clock)) {
      this.scheduleCronWithFakeClock(routine.id, trigger);
      return;
    }

    const job = new Cron(
      trigger.cron,
      { timezone: trigger.timezone, catch: trigger.catchUp === "last" },
      () => this.onFire(routine.id, "schedule"),
    );
    this.jobs.set(routine.id, { stop: () => job.stop() });
  }

  private scheduleCronWithFakeClock(routineId: string, trigger: RoutineScheduleTrigger): void {
    const clock = this.ctx.clock as FakeClockLike;
    const job = new Cron(trigger.cron!, { timezone: trigger.timezone, paused: true });
    let timerId: number | undefined;

    const scheduleNext = (): void => {
      const next = job.nextRun(clock.now());
      if (!next) return;
      const delay = Math.max(0, next.getTime() - clock.now().getTime());
      timerId = clock.setTimeout(() => {
        this.onFire(routineId, "schedule");
        scheduleNext();
      }, delay);
    };

    scheduleNext();
    this.jobs.set(routineId, {
      stop: () => {
        if (timerId !== undefined) clock.clearTimeout(timerId);
        job.stop();
      },
    });
  }

  private scheduleOnce(routineId: string, trigger: RoutineScheduleTrigger): void {
    const at = new Date(trigger.at!);
    const fire = (): void => {
      if (!this.firedOnce.has(routineId)) {
        this.firedOnce.add(routineId);
        this.onFire(routineId, "schedule");
      }
    };

    if (isFakeClock(this.ctx.clock)) {
      const clock = this.ctx.clock as FakeClockLike;
      const delay = Math.max(0, at.getTime() - clock.now().getTime());
      const timerId = clock.setTimeout(fire, delay);
      this.jobs.set(routineId, { stop: () => clock.clearTimeout(timerId) });
      return;
    }

    const delay = at.getTime() - Date.now();
    if (delay < 0 && trigger.catchUp === "none") return;
    const timerId = setTimeout(fire, Math.max(0, delay));
    this.jobs.set(routineId, { stop: () => clearTimeout(timerId) });
  }

  unschedule(routineId: string): void {
    const job = this.jobs.get(routineId);
    if (job) {
      job.stop();
      this.jobs.delete(routineId);
    }
    this.firedOnce.delete(routineId);
  }

  stopAll(): void {
    for (const [id] of this.jobs) this.unschedule(id);
  }

  /** Validates minimum schedule interval (O7: 15 min). */
  /**
   * O7: no schedule may fire more often than every 15 minutes. Checks the gaps
   * between the next firings, so any cron form counts (`* * * * *`, `0-59 ...`,
   * `0,5 ...`), not only `*\/N`.
   */
  static validateScheduleInterval(trigger: RoutineScheduleTrigger): boolean {
    if (trigger.at) return true;
    if (!trigger.cron) return false;
    let runs: Date[];
    try {
      runs = new Cron(trigger.cron, { paused: true, timezone: trigger.timezone }).nextRuns(64);
    } catch {
      return false;
    }
    const minGapMs = O7_GUARDRAILS.minScheduleIntervalMin * 60_000;
    for (let i = 1; i < runs.length; i++) {
      if (runs[i]!.getTime() - runs[i - 1]!.getTime() < minGapMs) return false;
    }
    return true;
  }

  getScheduledIds(): string[] {
    return [...this.jobs.keys()];
  }
}
