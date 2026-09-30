import { describe, expect, it } from "vitest";
import { FakeClock } from "@openbot/testkit";
import { CapCounterService, DEFAULT_AUTONOMY_CAPS } from "./caps.js";

/** The conservative limits these tests are about; the shipped defaults are looser so the Chief can delegate freely. */
const STRICT_CAPS = {
  ...DEFAULT_AUTONOMY_CAPS,
  cosCreatedBotsMax: 6,
  newBotsPerDay: 2,
  spawnCooldownMin: 30,
};

describe("CapCounterService property: no sequence exceeds S1–S6", () => {
  it("never exceeds daily spawn cap S2", () => {
    const clock = new FakeClock(new Date("2026-09-27T00:00:00Z"));
    const caps = new CapCounterService(clock);
    const limit = STRICT_CAPS.newBotsPerDay;

    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      const result = caps.checkDailySpawnCap(STRICT_CAPS);
      if (result.ok) allowed += 1;
    }
    expect(allowed).toBe(limit);
  });

  it("never exceeds per-bot hourly notify cap S4", () => {
    const caps = new CapCounterService(new FakeClock());
    const limit = STRICT_CAPS.proactivePerBotHour;
    let allowed = 0;

    for (let count = 0; count < 10; count++) {
      const result = caps.checkNotifyCaps("bot_a", STRICT_CAPS, {
        botHour: count,
        botDay: count,
        globalHour: count,
      });
      if (result.ok) allowed += 1;
    }
    expect(allowed).toBe(limit);
  });

  it("never exceeds global hourly notify cap S5", () => {
    const caps = new CapCounterService(new FakeClock());
    const limit = STRICT_CAPS.proactiveGlobalHour;
    let allowed = 0;

    for (let count = 0; count < 10; count++) {
      const result = caps.checkNotifyCaps("bot_a", STRICT_CAPS, {
        botHour: 0,
        botDay: 0,
        globalHour: count,
      });
      if (result.ok) allowed += 1;
    }
    expect(allowed).toBe(limit);
  });

  it("detects duplicate dedupe_key within S6 window", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const caps = new CapCounterService(new FakeClock(now));
    const recent = [{ dedupeKey: "topic-a", at: new Date("2026-09-27T08:00:00Z") }];
    expect(caps.hasRecentDedupe("topic-a", recent, STRICT_CAPS, now)).toBe(true);
    expect(caps.hasRecentDedupe("topic-b", recent, STRICT_CAPS, now)).toBe(false);
  });

  it("enforces spawn cooldown S3", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const caps = new CapCounterService(new FakeClock(now));
    const recent = new Date("2026-09-27T11:50:00Z");
    expect(caps.checkSpawnCooldown(recent, STRICT_CAPS, now).ok).toBe(false);
    expect(caps.checkSpawnCooldown(new Date("2026-09-27T11:00:00Z"), STRICT_CAPS, now).ok).toBe(
      true,
    );
  });

  it("halves caps in conservative mode", () => {
    const caps = new CapCounterService(new FakeClock());
    const normal = caps.checkNotifyCaps("bot_a", STRICT_CAPS, {
      botHour: 2,
      botDay: 2,
      globalHour: 2,
    });
    expect(normal.ok).toBe(true);

    const conservative = caps.checkNotifyCaps(
      "bot_a",
      STRICT_CAPS,
      { botHour: 2, botDay: 2, globalHour: 2 },
      true,
    );
    expect(conservative.ok).toBe(false);
  });
});

describe("CapCounterService spawn history (S2/S3 inputs)", () => {
  it("counts only recorded spawns inside the rolling 24 h window", () => {
    const clock = new FakeClock(new Date("2026-09-27T00:00:00Z"));
    const caps = new CapCounterService(clock);
    expect(caps.spawnsInLast24h()).toBe(0);
    expect(caps.lastSpawnAt()).toBeUndefined();

    caps.recordSpawn();
    clock.advance(12 * 60 * 60_000);
    caps.recordSpawn();
    expect(caps.spawnsInLast24h()).toBe(2);
    expect(caps.lastSpawnAt()?.toISOString()).toBe("2026-09-27T12:00:00.000Z");

    clock.advance(12 * 60 * 60_000);
    expect(caps.spawnsInLast24h()).toBe(1);
  });
});
