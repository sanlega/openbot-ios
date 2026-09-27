import type { Clock } from "@openbot/contracts";

interface Timer {
  id: number;
  dueAt: number;
  fn: () => void;
}

/**
 * Deterministic `Clock` (plan §5 WS0 fakes list) for cap-window (WS7) and
 * scheduler (WS12) tests. `advance(ms)` moves the fake clock forward in one
 * jump and synchronously fires every timer whose `dueAt` falls within the new
 * window, in `dueAt` order — no real `setTimeout` is ever used, so tests never
 * need to wait on wall-clock time.
 */
export class FakeClock implements Clock {
  private currentMs: number;
  private timers: Timer[] = [];
  private nextTimerId = 1;

  constructor(startAt: Date | number = 0) {
    this.currentMs = typeof startAt === "number" ? startAt : startAt.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  /** Schedules `fn` to run after `delayMs` of fake time; returns a cancellable timer id. */
  setTimeout(fn: () => void, delayMs: number): number {
    const id = this.nextTimerId++;
    this.timers.push({ id, dueAt: this.currentMs + delayMs, fn });
    return id;
  }

  clearTimeout(id: number): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  advance(ms: number): void {
    const target = this.currentMs + ms;
    // Fire due timers as time passes, so a timer scheduled by another timer's
    // callback (still within the advanced window) also fires in order.
    for (;;) {
      const due = this.timers.filter((t) => t.dueAt <= target).sort((a, b) => a.dueAt - b.dueAt)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.currentMs = due.dueAt;
      due.fn();
    }
    this.currentMs = target;
  }
}
