import { describe, expect, it } from "vitest";
import { RoutineScheduler } from "./scheduler.js";

function schedule(cron: string) {
  return { type: "schedule" as const, cron, timezone: "UTC", catchUp: "none" as const };
}

describe("RoutineScheduler.validateScheduleInterval (O7: at most every 15 min)", () => {
  it.each(["*/15 * * * *", "0 8 * * *", "0,30 * * * *", "0 */2 * * 1-5"])("accepts %s", (cron) => {
    expect(RoutineScheduler.validateScheduleInterval(schedule(cron))).toBe(true);
  });

  it.each(["* * * * *", "*/5 * * * *", "0-59 * * * *", "0,5 * * * *", "0,1 8 * * *"])(
    "rejects %s",
    (cron) => {
      expect(RoutineScheduler.validateScheduleInterval(schedule(cron))).toBe(false);
    },
  );

  it("rejects an unparseable cron expression", () => {
    expect(RoutineScheduler.validateScheduleInterval(schedule("every minute"))).toBe(false);
  });
});
