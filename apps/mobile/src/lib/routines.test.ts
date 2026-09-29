import { describe, expect, it } from "vitest";
import { describeTrigger } from "./routines";

const schedule = (cron: string) =>
  ({ type: "schedule", cron, timezone: "UTC", catchUp: "none" }) as const;

describe("describeTrigger", () => {
  it("turns common cron schedules into words", () => {
    expect(describeTrigger(schedule("0 8 * * 1-5"))).toBe("Weekdays at 08:00");
    expect(describeTrigger(schedule("30 18 * * *"))).toBe("Every day at 18:30");
    expect(describeTrigger(schedule("15 * * * *"))).toBe("Every hour");
    expect(describeTrigger(schedule("0 9 * * 1"))).toBe("Mondays at 09:00");
    expect(describeTrigger(schedule("*/5 1 1 * *"))).toBe("*/5 1 1 * *");
  });

  it("describes event triggers", () => {
    expect(describeTrigger({ type: "event", source: "webhook" })).toBe("When a webhook fires");
  });
});
