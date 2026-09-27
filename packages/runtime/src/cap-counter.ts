import type { Clock } from "@openbot/contracts";

/**
 * Rolling-window counter (plan §4.1 `CapCounter`, §5 WS2: "`CapCounter`
 * service: rolling windows, used by WS8 and WS12"). A sliding window over a
 * timestamp log — precise, and cheap enough for caps this small (S1-S10, O7
 * are all single-digit-to-low-hundreds counts per window).
 */
export interface CapCounterStore {
  /** Records one occurrence at `nowMs` and returns the count within the trailing `windowMs`, including the new occurrence. */
  record(scope: string, key: string, nowMs: number, windowMs: number): number;
  /** Counts occurrences within the trailing `windowMs`, without recording a new one. */
  count(scope: string, key: string, nowMs: number, windowMs: number): number;
  /** The most recent occurrence's timestamp, or `undefined` if there is none. */
  lastAt(scope: string, key: string): number | undefined;
}

export class InMemoryCapCounterStore implements CapCounterStore {
  private readonly timestampsMs = new Map<string, number[]>();

  private prune(mapKey: string, nowMs: number, windowMs: number): number[] {
    const kept = (this.timestampsMs.get(mapKey) ?? []).filter((t) => nowMs - t < windowMs);
    this.timestampsMs.set(mapKey, kept);
    return kept;
  }

  record(scope: string, key: string, nowMs: number, windowMs: number): number {
    const mapKey = `${scope}:${key}`;
    const kept = this.prune(mapKey, nowMs, windowMs);
    kept.push(nowMs);
    this.timestampsMs.set(mapKey, kept);
    return kept.length;
  }

  count(scope: string, key: string, nowMs: number, windowMs: number): number {
    return this.prune(`${scope}:${key}`, nowMs, windowMs).length;
  }

  lastAt(scope: string, key: string): number | undefined {
    const all = this.timestampsMs.get(`${scope}:${key}`);
    if (!all || all.length === 0) return undefined;
    return Math.max(...all);
  }
}

/**
 * Convenience wrapper over a {@link CapCounterStore} bound to a {@link Clock},
 * so callers (S1-S10 in WS8, O7 in WS12) don't each re-derive `now()`.
 */
export class CapCounterService {
  constructor(
    private readonly store: CapCounterStore,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  /** Would recording one more occurrence right now exceed `max` within `windowMs`? Checked WITHOUT recording, so a refused action never counts against the window. */
  wouldExceed(scope: string, key: string, windowMs: number, max: number): boolean {
    return this.count(scope, key, windowMs) >= max;
  }

  record(scope: string, key: string, windowMs: number): number {
    return this.store.record(scope, key, this.clock.now().getTime(), windowMs);
  }

  count(scope: string, key: string, windowMs: number): number {
    return this.store.count(scope, key, this.clock.now().getTime(), windowMs);
  }

  /** Milliseconds since the last occurrence, or `undefined` if there has never been one — for cooldown-style caps (e.g. S3: 30 min between spawns). */
  msSinceLast(scope: string, key: string): number | undefined {
    const last = this.store.lastAt(scope, key);
    if (last === undefined) return undefined;
    return this.clock.now().getTime() - last;
  }
}
