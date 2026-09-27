import { openDb } from "@openbot/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteCapCounterStore } from "./cap-counter-sqlite.js";
import { CapCounterService } from "./cap-counter.js";

describe("SqliteCapCounterStore (:memory: SQLite)", () => {
  let close: () => void;
  let store: SqliteCapCounterStore;

  beforeEach(() => {
    const opened = openDb({ path: ":memory:" });
    close = opened.close;
    store = new SqliteCapCounterStore(opened.db);
  });

  afterEach(() => close());

  it("records occurrences and counts within the window", () => {
    expect(store.record("spawn", "bot_a", 1_000, 60_000)).toBe(1);
    expect(store.record("spawn", "bot_a", 2_000, 60_000)).toBe(2);
    expect(store.count("spawn", "bot_a", 2_500, 60_000)).toBe(2);
  });

  it("resets the bucket once the window has elapsed", () => {
    store.record("spawn", "bot_a", 1_000, 60_000);
    store.record("spawn", "bot_a", 2_000, 60_000);
    expect(store.count("spawn", "bot_a", 100_000, 60_000)).toBe(0);
    expect(store.record("spawn", "bot_a", 100_000, 60_000)).toBe(1);
  });

  it("keeps separate counters per scope+key", () => {
    store.record("spawn", "bot_a", 1_000, 60_000);
    store.record("spawn", "bot_b", 1_000, 60_000);
    expect(store.count("spawn", "bot_a", 1_000, 60_000)).toBe(1);
    expect(store.count("spawn", "bot_b", 1_000, 60_000)).toBe(1);
    expect(store.count("spawn", "bot_c", 1_000, 60_000)).toBe(0);
  });

  it("tracks lastAt for cooldown-style caps", () => {
    expect(store.lastAt("spawn", "bot_a")).toBeUndefined();
    store.record("spawn", "bot_a", 5_000, 60_000);
    expect(store.lastAt("spawn", "bot_a")).toBe(5_000);
  });

  it("persists across a CapCounterService bound to a Clock", () => {
    let nowMs = 0;
    const service = new CapCounterService(store, { now: () => new Date(nowMs) });
    expect(service.wouldExceed("spawn", "bot_a", 60_000, 1)).toBe(false);
    service.record("spawn", "bot_a", 60_000);
    expect(service.wouldExceed("spawn", "bot_a", 60_000, 1)).toBe(true);
    nowMs = 61_000;
    expect(service.wouldExceed("spawn", "bot_a", 60_000, 1)).toBe(false);
  });
});
