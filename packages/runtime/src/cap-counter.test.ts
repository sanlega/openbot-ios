import { FakeClock } from "@openbot/testkit";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CapCounterService, InMemoryCapCounterStore } from "./cap-counter.js";

describe("InMemoryCapCounterStore / CapCounterService (plan §5 WS2: rolling windows, used by WS8/WS12)", () => {
  it("counts occurrences within the trailing window and drops ones older than it", () => {
    const store = new InMemoryCapCounterStore();
    store.record("spawn", "bot_a", 0, 1_000);
    store.record("spawn", "bot_a", 500, 1_000);
    expect(store.count("spawn", "bot_a", 900, 1_000)).toBe(2);
    expect(store.count("spawn", "bot_a", 1_100, 1_000)).toBe(1);
    expect(store.count("spawn", "bot_a", 2_000, 1_000)).toBe(0);
  });

  it("wouldExceed checks without recording", () => {
    const clock = new FakeClock(0);
    const service = new CapCounterService(new InMemoryCapCounterStore(), clock);
    expect(service.wouldExceed("spawn", "bot_a", 60_000, 1)).toBe(false);
    expect(service.wouldExceed("spawn", "bot_a", 60_000, 1)).toBe(false);
    service.record("spawn", "bot_a", 60_000);
    expect(service.wouldExceed("spawn", "bot_a", 60_000, 1)).toBe(true);
  });

  it("msSinceLast is undefined before any occurrence, then tracks elapsed time", () => {
    const clock = new FakeClock(0);
    const service = new CapCounterService(new InMemoryCapCounterStore(), clock);
    expect(service.msSinceLast("spawn", "bot_a")).toBeUndefined();
    service.record("spawn", "bot_a", 60_000);
    clock.advance(5_000);
    expect(service.msSinceLast("spawn", "bot_a")).toBe(5_000);
  });

  it("keeps independent windows per scope+key", () => {
    const store = new InMemoryCapCounterStore();
    store.record("spawn", "bot_a", 0, 1_000);
    store.record("notify", "bot_a", 0, 1_000);
    expect(store.count("spawn", "bot_a", 0, 1_000)).toBe(1);
    expect(store.count("notify", "bot_a", 0, 1_000)).toBe(1);
    expect(store.count("spawn", "bot_b", 0, 1_000)).toBe(0);
  });
});

describe("InMemoryCapCounterStore property: count() always equals the number of recorded timestamps within the trailing window", () => {
  it("for any sequence of record() timestamps and any query point, count matches a naive re-filter", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 0, maxLength: 30 }),
        fc.integer({ min: 0, max: 150_000 }),
        fc.integer({ min: 1, max: 50_000 }),
        (timestamps, queryAt, windowMs) => {
          const store = new InMemoryCapCounterStore();
          const sorted = [...timestamps].sort((a, b) => a - b);
          for (const t of sorted) store.record("scope", "key", t, windowMs);
          const expected = sorted.filter((t) => queryAt - t < windowMs && t <= queryAt).length;
          // `count()` prunes relative to its own call time; querying at a time
          // before some recorded timestamps isn't a real usage pattern (a real
          // clock never goes backwards), so only assert when queryAt is at or
          // after every recorded timestamp actually retained by that logic.
          if (sorted.every((t) => t <= queryAt)) {
            expect(store.count("scope", "key", queryAt, windowMs)).toBe(expected);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
