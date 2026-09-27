import type { RoutineTrigger } from "@openbot/contracts";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ALIASES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isNum(s: string): boolean {
  return /^\d+$/.test(s);
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "1-5" / "MON,WED" / "0" → sorted day numbers (0 = Sunday), or null when not simple. */
function parseDays(field: string): number[] | null {
  const days = new Set<number>();
  for (const part of field.toUpperCase().split(",")) {
    const range = /^(\w+)-(\w+)$/.exec(part);
    const toNum = (s: string) => (isNum(s) ? Number(s) % 7 : DAY_ALIASES[s]);
    if (range) {
      const a = toNum(range[1]!);
      const b = toNum(range[2]!);
      if (a === undefined || b === undefined) return null;
      const end = Number(range[2]) === 7 ? 7 : b;
      for (let d = a; d <= end; d++) days.add(d % 7);
    } else {
      const d = toNum(part);
      if (d === undefined || Number.isNaN(d)) return null;
      days.add(d);
    }
  }
  return [...days].sort((x, y) => x - y);
}

function dayPhrase(days: number[]): string {
  const key = days.join(",");
  if (key === "1,2,3,4,5") return "Weekdays";
  if (key === "0,6") return "Weekends";
  if (days.length === 7) return "Every day";
  return `Every ${listWords(days.map((d) => DAYS[d]!))}`;
}

/**
 * A cron expression in words for the common forms ("Every day at 08:00",
 * "Every 15 minutes", "Weekdays at 09:30"); null when it is not one of them.
 */
export function describeCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string];
  if (month !== "*") return null;

  // Every N minutes / hours.
  const everyMin = /^\*\/(\d+)$/.exec(min);
  if (everyMin && hour === "*" && dom === "*" && dow === "*") {
    const n = Number(everyMin[1]);
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }
  const everyHour = /^\*\/(\d+)$/.exec(hour);
  if (isNum(min) && (everyHour || hour === "*") && dom === "*" && dow === "*") {
    const n = everyHour ? Number(everyHour[1]) : 1;
    const at = Number(min) === 0 ? "" : ` at :${pad(Number(min))}`;
    return n === 1 ? `Every hour${at}` : `Every ${n} hours${at}`;
  }

  // At fixed times of day.
  if (!isNum(min)) return null;
  const hours = hour.split(",");
  if (!hours.every(isNum)) return null;
  const times = listWords(hours.map((h) => `${pad(Number(h))}:${pad(Number(min))}`));

  if (dom === "*" && dow === "*") return `Every day at ${times}`;
  if (dom === "*") {
    const days = parseDays(dow);
    return days ? `${dayPhrase(days)} at ${times}` : null;
  }
  if (dow === "*" && dom.split(",").every(isNum)) {
    const doms = dom.split(",").map((d) => ordinal(Number(d)));
    return `Monthly on the ${listWords(doms)} at ${times}`;
  }
  return null;
}

/** The whole trigger in words; falls back to the raw cron when it is unusual. */
export function describeTrigger(trigger: RoutineTrigger): string {
  if (trigger.type === "schedule") {
    if (trigger.at) {
      const d = new Date(trigger.at);
      return `Once, ${d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
    }
    if (!trigger.cron) return "No schedule";
    return describeCron(trigger.cron) ?? `Cron: ${trigger.cron}`;
  }
  switch (trigger.source) {
    case "webhook":
      return "When a webhook is received";
    case "file":
      return trigger.path ? `When ${trigger.path} changes` : "When a file changes";
    case "connector":
      return trigger.triggerSlug
        ? `When ${humanizeSlug(trigger.triggerSlug)} happens`
        : "When a connected app sends an event";
    case "openbot":
      return trigger.eventType ? `On OpenBot event “${trigger.eventType}”` : "On an OpenBot event";
  }
}

function humanizeSlug(slug: string): string {
  const words = slug.toLowerCase().replace(/[_-]+/g, " ").trim();
  return words ? `“${words}”` : "an event";
}

/** Presets offered when creating a routine (the harness enforces a 15-minute minimum). */
export type SchedulePreset = "daily" | "weekdays" | "weekly" | "hourly" | "interval" | "custom";

export function buildCron(
  preset: SchedulePreset,
  opts: { time: string; weekday: number; everyMin: number; custom: string },
): string {
  const [h, m] = opts.time.split(":").map((x) => Number(x) || 0);
  switch (preset) {
    case "daily":
      return `${m} ${h} * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * ${opts.weekday}`;
    case "hourly":
      return "0 * * * *";
    case "interval":
      return opts.everyMin >= 60 && opts.everyMin % 60 === 0
        ? `0 */${opts.everyMin / 60} * * *`
        : `*/${opts.everyMin} * * * *`;
    case "custom":
      return opts.custom.trim();
  }
}

export { DAYS };
