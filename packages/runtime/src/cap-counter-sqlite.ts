import type { Clock } from "@openbot/contracts";
import type { Db } from "@openbot/store";
import { schema } from "@openbot/store";
import { and, eq } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import type { CapCounterStore } from "./cap-counter.js";

// `@openbot/contracts`'s `newId()` has no `capCounter` kind (plan §4.1's ID
// prefix list omits `CapCounter`) — a small contracts gap, not something
// WS2 should just add unasked; generate a locally-prefixed ULID instead.
const ulid = monotonicFactory();
function newCapCounterId(): string {
  return `capctr_${ulid()}`;
}

/**
 * `CapCounterStore` backed by `@openbot/store`'s persisted `cap_counters`
 * table (plan §4.1 `CapCounter`). The in-memory {@link InMemoryCapCounterStore}
 * (`cap-counter.ts`) keeps an exact sliding-window timestamp log; this
 * persisted adapter instead does **fixed-window bucketing** — one row per
 * `scope`+`key`, reset whenever `nowMs` has moved past `windowStart +
 * windowSec`. That's a deliberate precision-for-persistence tradeoff (a
 * single row per counter, no unbounded timestamp history to prune/persist)
 * and is coarser at window boundaries than the sliding-window log: a burst
 * split across a bucket reset can undercount slightly. Fine for S1-S10/O7's
 * cap windows (minutes-to-a-day, single-digit-to-low-hundreds limits); swap
 * for a sliding-window table if a workstream ever needs exactness there.
 *
 * Callers must pass the same `windowMs` on every `record`/`count` for a
 * given `scope`+`key` (as {@link CapCounterService}'s callers always do —
 * one fixed window per cap kind) since only one bucket is kept per counter.
 */
export class SqliteCapCounterStore implements CapCounterStore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  private row(scope: string, key: string) {
    return this.db
      .select()
      .from(schema.capCounters)
      .where(and(eq(schema.capCounters.scope, scope), eq(schema.capCounters.key, key)))
      .get();
  }

  record(scope: string, key: string, nowMs: number, windowMs: number): number {
    const windowSec = Math.max(1, Math.round(windowMs / 1000));
    const existing = this.row(scope, key);
    const windowExpired = !existing || nowMs - existing.windowStart.getTime() >= windowMs;

    if (!existing) {
      this.db
        .insert(schema.capCounters)
        .values({
          id: newCapCounterId(),
          scope,
          key,
          windowStart: new Date(nowMs),
          windowSec,
          count: 1,
        })
        .run();
      return 1;
    }

    if (windowExpired) {
      this.db
        .update(schema.capCounters)
        .set({ windowStart: new Date(nowMs), windowSec, count: 1 })
        .where(eq(schema.capCounters.id, existing.id))
        .run();
      return 1;
    }

    const count = existing.count + 1;
    this.db
      .update(schema.capCounters)
      .set({ count })
      .where(eq(schema.capCounters.id, existing.id))
      .run();
    return count;
  }

  count(scope: string, key: string, nowMs: number, windowMs: number): number {
    const existing = this.row(scope, key);
    if (!existing) return 0;
    const windowExpired = nowMs - existing.windowStart.getTime() >= windowMs;
    return windowExpired ? 0 : existing.count;
  }

  lastAt(scope: string, key: string): number | undefined {
    const existing = this.row(scope, key);
    return existing ? existing.windowStart.getTime() : undefined;
  }
}
