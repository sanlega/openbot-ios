import { describe, expect, it } from "vitest";
import { buildCron, describeCron, describeTrigger } from "./schedule.js";

describe("describeCron", () => {
  it.each([
    ["0 8 * * *", "Every day at 08:00"],
    ["30 9 * * 1-5", "Weekdays at 09:30"],
    ["0 10 * * 0,6", "Weekends at 10:00"],
    ["0 18 * * 1", "Every Monday at 18:00"],
    ["0 9 * * MON,WED,FRI", "Every Monday, Wednesday and Friday at 09:00"],
    ["*/15 * * * *", "Every 15 minutes"],
    ["0 * * * *", "Every hour"],
    ["5 */2 * * *", "Every 2 hours at :05"],
    ["0 8,17 * * *", "Every day at 08:00 and 17:00"],
    ["0 7 1 * *", "Monthly on the 1st at 07:00"],
  ])("%s → %s", (cron, words) => {
    expect(describeCron(cron)).toBe(words);
  });

  it("returns null for forms it does not know", () => {
    expect(describeCron("0 8 * 1 *")).toBeNull();
    expect(describeCron("0-30/5 8 * * *")).toBeNull();
    expect(describeCron("bad")).toBeNull();
  });
});

describe("describeTrigger", () => {
  it("falls back to the raw cron", () => {
    expect(
      describeTrigger({ type: "schedule", cron: "0 8 * 1 *", timezone: "UTC", catchUp: "none" }),
    ).toBe("Cron: 0 8 * 1 *");
  });

  it("describes event triggers", () => {
    expect(describeTrigger({ type: "event", source: "webhook" })).toBe(
      "When a webhook is received",
    );
  });
});

describe("buildCron", () => {
  const opts = { time: "08:30", weekday: 2, everyMin: 30, custom: "" };
  it("builds the presets", () => {
    expect(buildCron("daily", opts)).toBe("30 8 * * *");
    expect(buildCron("weekdays", opts)).toBe("30 8 * * 1-5");
    expect(buildCron("weekly", opts)).toBe("30 8 * * 2");
    expect(buildCron("interval", opts)).toBe("*/30 * * * *");
    expect(buildCron("interval", { ...opts, everyMin: 120 })).toBe("0 */2 * * *");
  });
});
