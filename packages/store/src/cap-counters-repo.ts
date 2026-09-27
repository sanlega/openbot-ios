import type { CapCounter } from "@openbot/contracts";
import { and, eq } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import type { Db } from "./db.js";
import { capCounters } from "./schema.js";

type CapCounterRow = typeof capCounters.$inferSelect;

/** No dedicated ID prefix exists for this entity in the plan's §4.1 prefix list; use a plain ULID. */
const ulid = monotonicFactory();

/**
 * Rolling-window counters backing caps S1-S10/O7 (plan §4.1). WS2/WS8/WS12 own the
 * actual cap rules; this is just the shared, race-free storage they all read/write.
 */
export class CapCountersRepo {
  constructor(private readonly db: Db) {}

  getOrCreate(scope: string, key: string, windowSec: number, now: Date): CapCounter {
    const existing = this.db
      .select()
      .from(capCounters)
      .where(and(eq(capCounters.scope, scope), eq(capCounters.key, key)))
      .get();
    if (existing) return toCounter(existing);

    const row = {
      id: `cnt_${ulid()}`,
      scope,
      key,
      windowStart: now,
      windowSec,
      count: 0,
    };
    this.db.insert(capCounters).values(row).run();
    return toCounter(row);
  }

  /** Resets the window if `now` has moved past it, then increments by `by`. Returns the post-increment count. */
  incrementInWindow(scope: string, key: string, windowSec: number, now: Date, by = 1): number {
    const counter = this.getOrCreate(scope, key, windowSec, now);
    const windowStart = new Date(counter.windowStart);
    const windowElapsedMs = now.getTime() - windowStart.getTime();
    const withinWindow = windowElapsedMs < windowSec * 1000;
    const nextCount = (withinWindow ? counter.count : 0) + by;
    this.db
      .update(capCounters)
      .set({
        windowStart: withinWindow ? windowStart : now,
        count: nextCount,
      })
      .where(and(eq(capCounters.scope, scope), eq(capCounters.key, key)))
      .run();
    return nextCount;
  }

  get(scope: string, key: string): CapCounter | undefined {
    const row = this.db
      .select()
      .from(capCounters)
      .where(and(eq(capCounters.scope, scope), eq(capCounters.key, key)))
      .get();
    return row ? toCounter(row) : undefined;
  }
}

function toCounter(row: CapCounterRow): CapCounter {
  return {
    id: row.id,
    scope: row.scope,
    key: row.key,
    windowStart: row.windowStart.toISOString(),
    windowSec: row.windowSec,
    count: row.count,
  };
}
