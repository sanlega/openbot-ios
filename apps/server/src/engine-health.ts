import type { EngineId } from "@openbot/contracts";

/** Engine errors that mean "this account can't run turns right now", not "this task failed". */
const OUT_OF_SERVICE =
  /session limit|usage limit|rate.?limit|quota|insufficient_quota|credit balance|429|overloaded|not logged in|authentication_failed|please run \/login/i;

export function isOutOfService(reason: string | undefined): boolean {
  return Boolean(reason && OUT_OF_SERVICE.test(reason));
}

const DEFAULT_COOLDOWN_MS = 30 * 60_000;

/**
 * Which engines are temporarily unusable (out of quota, logged out), and until
 * when. Picking an engine skips those while another one is available.
 */
export class EngineHealth {
  private readonly until = new Map<EngineId, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  markOutOfService(engine: EngineId, reason: string | undefined): Date {
    const at =
      resetTimeFrom(reason, this.now()) ?? new Date(this.now().getTime() + DEFAULT_COOLDOWN_MS);
    this.until.set(engine, at.getTime());
    return at;
  }

  isAvailable(engine: EngineId): boolean {
    const until = this.until.get(engine);
    if (until === undefined) return true;
    if (until <= this.now().getTime()) {
      this.until.delete(engine);
      return true;
    }
    return false;
  }

  /** The engines to route between: healthy ones, or all of them if none is. */
  filter(engines: EngineId[]): EngineId[] {
    const healthy = engines.filter((e) => this.isAvailable(e));
    return healthy.length > 0 ? healthy : engines;
  }
}

/** Reads "resets 11:30pm" / "resets at 23:30" into the next such time; undefined if absent. */
export function resetTimeFrom(reason: string | undefined, now: Date): Date | undefined {
  const match = reason?.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  const at = new Date(now);
  at.setHours(hour, minute, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}
