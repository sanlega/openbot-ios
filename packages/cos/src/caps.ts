import type { Clock } from "@openbot/contracts";
import type { AutonomyCaps } from "./types.js";

/** Plan §2.2 / research §11.4 defaults (S1–S10, invisible to bots). */
export const DEFAULT_AUTONOMY_CAPS: AutonomyCaps = {
  cosCreatedBotsMax: 6,
  newBotsPerDay: 2,
  spawnCooldownMin: 30,
  proactivePerBotHour: 3,
  proactivePerBotDay: 8,
  proactiveGlobalHour: 6,
  dedupeWindowHours: 6,
  idleBotReviewDays: 7,
  mergeWindowMin: 10,
  digestHour: 18,
  followupMinHours: 4,
};

interface CounterRow {
  count: number;
  windowStartMs: number;
  windowSec: number;
}

/**
 * Rolling-window cap counter for S1–S6 (plan §4.1 `CapCounter`).
 * In-memory by default; WS1 can persist rows through `packages/store`.
 */
export class CapCounterService {
  private readonly counters = new Map<string, CounterRow>();
  private readonly spawnTimesMs: number[] = [];
  private readonly clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  private key(scope: string, key: string): string {
    return `${scope}::${key}`;
  }

  private nowMs(): number {
    return this.clock.now().getTime();
  }

  /** Current time on this service's clock (gates must not capture it at construction). */
  now(): Date {
    return this.clock.now();
  }

  /** Records a bot the CoS actually created (now, or `at` when replaying history); refused attempts are never recorded. */
  recordSpawn(at?: Date): void {
    this.spawnTimesMs.push(at ? at.getTime() : this.nowMs());
    this.spawnTimesMs.sort((a, b) => a - b);
  }

  /** S2 input: successful spawns in the rolling 24 h before now. */
  spawnsInLast24h(): number {
    const cutoff = this.nowMs() - 86_400_000;
    return this.spawnTimesMs.filter((ts) => ts > cutoff).length;
  }

  /** S3 input: when the last successful spawn happened, if any. */
  lastSpawnAt(): Date | undefined {
    const last = this.spawnTimesMs[this.spawnTimesMs.length - 1];
    return last === undefined ? undefined : new Date(last);
  }

  /** Read the current count without incrementing. */
  peek(scope: string, key: string, windowSec: number): number {
    const row = this.counters.get(this.key(scope, key));
    if (!row || row.windowSec !== windowSec) return 0;
    const elapsed = (this.nowMs() - row.windowStartMs) / 1000;
    if (elapsed >= windowSec) return 0;
    return row.count;
  }

  /**
   * Increment if under `limit`, rolling the window when expired.
   * Returns `{ ok: true, count }` or `{ ok: false, count, reason }`.
   */
  checkAndIncrement(
    scope: string,
    key: string,
    windowSec: number,
    limit: number,
  ): { ok: boolean; count: number; reason?: string } {
    const mapKey = this.key(scope, key);
    const now = this.nowMs();
    let row = this.counters.get(mapKey);

    if (!row || row.windowSec !== windowSec || (now - row.windowStartMs) / 1000 >= windowSec) {
      row = { count: 0, windowStartMs: now, windowSec };
    }

    if (row.count >= limit) {
      return {
        ok: false,
        count: row.count,
        reason: `cap exceeded: ${scope}/${key} (${row.count}/${limit} in ${windowSec}s)`,
      };
    }

    row.count += 1;
    this.counters.set(mapKey, row);
    return { ok: true, count: row.count };
  }

  /** S1: CoS-created bots in roster (not a rolling window — checked externally). */
  checkRosterCap(cosCreatedCount: number, caps: AutonomyCaps): { ok: boolean; reason?: string } {
    if (cosCreatedCount >= caps.cosCreatedBotsMax) {
      return {
        ok: false,
        reason: `roster cap reached (${cosCreatedCount}/${caps.cosCreatedBotsMax}): reuse or ask the user to archive a bot`,
      };
    }
    return { ok: true };
  }

  /** S2: new bots per rolling 24 h. */
  checkDailySpawnCap(caps: AutonomyCaps): { ok: boolean; count: number; reason?: string } {
    const result = this.checkAndIncrement("spawn", "daily", 86_400, caps.newBotsPerDay);
    if (!result.ok) {
      return {
        ok: false,
        count: result.count,
        reason: `daily spawn cap reached (${result.count}/${caps.newBotsPerDay} in 24h)`,
      };
    }
    return { ok: true, count: result.count };
  }

  /** S3: cooldown between spawns. Uses a single-slot window. */
  checkSpawnCooldown(
    lastSpawnAt: Date | undefined,
    caps: AutonomyCaps,
    now: Date,
  ): { ok: boolean; reason?: string } {
    if (!lastSpawnAt) return { ok: true };
    const elapsedMin = (now.getTime() - lastSpawnAt.getTime()) / 60_000;
    if (elapsedMin < caps.spawnCooldownMin) {
      const waitMin = Math.ceil(caps.spawnCooldownMin - elapsedMin);
      return {
        ok: false,
        reason: `spawn cooldown: wait ${waitMin} min (last spawn ${Math.floor(elapsedMin)} min ago)`,
      };
    }
    return { ok: true };
  }

  /** S4/S5: proactive message caps. Halve limits in conservative mode. */
  checkNotifyCaps(
    botId: string,
    caps: AutonomyCaps,
    counts: { botHour: number; botDay: number; globalHour: number },
    conservative = false,
  ): { ok: boolean; reason?: string } {
    const factor = conservative ? 0.5 : 1;
    const perBotHour = Math.max(1, Math.floor(caps.proactivePerBotHour * factor));
    const perBotDay = Math.max(1, Math.floor(caps.proactivePerBotDay * factor));
    const globalHour = Math.max(1, Math.floor(caps.proactiveGlobalHour * factor));

    if (counts.botHour >= perBotHour) {
      return { ok: false, reason: `per-bot hourly message cap (${counts.botHour}/${perBotHour})` };
    }
    if (counts.botDay >= perBotDay) {
      return { ok: false, reason: `per-bot daily message cap (${counts.botDay}/${perBotDay})` };
    }
    if (counts.globalHour >= globalHour) {
      return {
        ok: false,
        reason: `global hourly message cap (${counts.globalHour}/${globalHour})`,
      };
    }
    return { ok: true };
  }

  /** S6: duplicate dedupe_key within window. */
  hasRecentDedupe(
    dedupeKey: string,
    recentDelivered: Array<{ dedupeKey?: string; at: Date }>,
    caps: AutonomyCaps,
    now: Date,
  ): boolean {
    const windowMs = caps.dedupeWindowHours * 3_600_000;
    return recentDelivered.some(
      (m) => m.dedupeKey === dedupeKey && now.getTime() - m.at.getTime() < windowMs,
    );
  }

  /** S10: merge window — same bot messaged recently. */
  inMergeWindow(lastMessageFromBotAt: Date | undefined, caps: AutonomyCaps, now: Date): boolean {
    if (!lastMessageFromBotAt) return false;
    const windowMs = caps.mergeWindowMin * 60_000;
    return now.getTime() - lastMessageFromBotAt.getTime() < windowMs;
  }

  /** S7: whether quiet hours are active. */
  isQuietHours(quietHours: AutonomyCaps["quietHours"], now: Date): boolean {
    if (!quietHours?.enabled) return false;
    const [startH, startM] = quietHours.start.split(":").map(Number);
    const [endH, endM] = quietHours.end.split(":").map(Number);
    const minutes = now.getHours() * 60 + now.getMinutes();
    const start = (startH ?? 0) * 60 + (startM ?? 0);
    const end = (endH ?? 0) * 60 + (endM ?? 0);
    if (start <= end) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
  }
}
