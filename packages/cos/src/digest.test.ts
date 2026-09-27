import { describe, expect, it, vi } from "vitest";
import { FakeClock } from "@openbot/testkit";
import { DigestService } from "./digest.js";
import type { Bot } from "@openbot/contracts";

describe("DigestService", () => {
  it("posts one digest per day at configured hour", () => {
    const clock = new FakeClock(new Date("2026-09-27T17:59:00Z"));
    const onDigest = vi.fn();
    const digest = new DigestService({ clock, onDigest, config: { hour: 18, minute: 0, timezone: "UTC" } });

    digest.add({ kind: "held_message", summary: "Progress update held", at: clock.now() });
    digest.tick();
    expect(onDigest).not.toHaveBeenCalled();

    clock.advance(2 * 60_000);
    digest.tick();
    expect(onDigest).toHaveBeenCalledTimes(1);

    clock.advance(60_000);
    digest.tick();
    expect(onDigest).toHaveBeenCalledTimes(1);
  });

  it("lists archive candidates for idle CoS-created bots (S9)", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    const bots: Bot[] = [
      {
        id: "b1",
        slug: "old-bot",
        name: "Old Bot",
        description: "Was useful once",
        createdBy: "cos",
        lastActiveAt: new Date("2026-09-15T12:00:00Z").toISOString(),
        routing: { mode: "auto" },
        permissionPreset: "read_only",
        computer: "none",
        connectors: [],
        limits: {},
        pinned: false,
        hidden: false,
        isChiefOfStaff: false,
      },
    ];
    const candidates = DigestService.archiveCandidates(bots, 7, now);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.name).toBe("Old Bot");
  });
});
