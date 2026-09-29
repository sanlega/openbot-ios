import type { Routine } from "@openbot/contracts";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Weekdays at 08:00", "Every day at 18:30", "Every hour", or the raw cron as a fallback. */
export function describeTrigger(trigger: Routine["trigger"]): string {
  if (trigger.type === "event") {
    const source = {
      connector: "a connected app",
      webhook: "a webhook",
      file: "a file change",
      openbot: "an OpenBot event",
    }[trigger.source];
    return `When ${source} fires`;
  }
  if (trigger.at) {
    const at = new Date(trigger.at);
    return Number.isNaN(at.getTime())
      ? "Once"
      : `Once, ${at.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
  }
  const cron = trigger.cron?.trim();
  if (!cron) return "On a schedule";
  const [minute, hour, dom, month, dow] = cron.split(/\s+/);
  if (dom !== "*" || month !== "*" || minute === undefined || hour === undefined) return cron;
  if (hour === "*" && /^\d+$/.test(minute)) return "Every hour";
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return cron;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (dow === "*") return `Every day at ${time}`;
  if (dow === "1-5") return `Weekdays at ${time}`;
  if (dow === "0,6" || dow === "6,0") return `Weekends at ${time}`;
  if (/^\d$/.test(dow ?? "")) return `${DAYS[Number(dow) % 7]}s at ${time}`;
  return cron;
}
