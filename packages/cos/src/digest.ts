import type { Bot } from "@openbot/contracts";
import type { Clock } from "@openbot/contracts";
import type { DigestConfig, DigestEntry } from "./types.js";
import { DEFAULT_AUTONOMY_CAPS } from "./caps.js";

export interface DigestServiceOptions {
  clock: Clock;
  config?: DigestConfig;
  onDigest: (body: string, entries: DigestEntry[]) => void;
}

/**
 * Daily digest (plan WS8): one CoS message at the configured hour listing
 * silent completions, held messages, routine results, and archive candidates (S9).
 */
export class DigestService {
  private readonly clock: Clock;
  private readonly config: DigestConfig;
  private readonly onDigest: (body: string, entries: DigestEntry[]) => void;
  private entries: DigestEntry[] = [];
  private lastDigestDate: string | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(options: DigestServiceOptions) {
    this.clock = options.clock;
    this.config = options.config ?? {
      hour: DEFAULT_AUTONOMY_CAPS.digestHour,
      minute: 0,
      timezone: "UTC",
    };
    this.onDigest = options.onDigest;
  }

  /** Queue an item for the next digest. */
  add(entry: DigestEntry): void {
    this.entries.push(entry);
  }

  /** Find CoS-created bots idle for S9 days (archive candidates). */
  static archiveCandidates(bots: Bot[], idleDays: number, now: Date): Bot[] {
    const thresholdMs = idleDays * 86_400_000;
    return bots.filter((b) => {
      if (b.createdBy === "user" || b.isChiefOfStaff || b.archivedAt) return false;
      if (!b.lastActiveAt) return true;
      const last = new Date(b.lastActiveAt).getTime();
      return now.getTime() - last >= thresholdMs;
    });
  }

  /** Render digest body from queued entries and archive candidates. */
  render(entries: DigestEntry[], archiveBots: Bot[]): string {
    const sections: string[] = ["Daily digest"];

    const silent = entries.filter((e) => e.kind === "silent_completion");
    if (silent.length > 0) {
      sections.push("\nCompleted (not messaged):");
      for (const e of silent) sections.push(`- ${e.botName ?? e.botId ?? "bot"}: ${e.summary}`);
    }

    const held = entries.filter((e) => e.kind === "held_message");
    if (held.length > 0) {
      sections.push("\nHeld messages:");
      for (const e of held) sections.push(`- ${e.botName ?? e.botId ?? "bot"}: ${e.summary}`);
    }

    const routines = entries.filter((e) => e.kind === "routine_result");
    if (routines.length > 0) {
      sections.push("\nRoutine results:");
      for (const e of routines) sections.push(`- ${e.summary}`);
    }

    const archive = entries.filter((e) => e.kind === "archive_candidate");
    const archiveFromBots = archiveBots.map((b) => `- ${b.name}: idle, archive?`);
    if (archive.length > 0 || archiveFromBots.length > 0) {
      sections.push("\nArchive candidates:");
      for (const e of archive) sections.push(`- ${e.botName ?? e.botId}: ${e.summary}`);
      sections.push(...archiveFromBots);
    }

    if (sections.length === 1) {
      sections.push("\nNothing to report today.");
    }

    return sections.join("\n");
  }

  /** Check if it's time to post the digest and fire if so. */
  tick(bots: Bot[] = [], idleDays = DEFAULT_AUTONOMY_CAPS.idleBotReviewDays): void {
    const now = this.clock.now();
    const local = wallClock(now, this.config.timezone);
    const dateKey = local.date;

    if (
      local.hour === this.config.hour &&
      local.minute >= this.config.minute &&
      this.lastDigestDate !== dateKey
    ) {
      const archiveBots = DigestService.archiveCandidates(bots, idleDays, now);
      for (const bot of archiveBots) {
        this.entries.push({
          kind: "archive_candidate",
          summary: "idle, archive?",
          botId: bot.id,
          botName: bot.name,
          at: now,
        });
      }

      const body = this.render(this.entries, archiveBots);
      this.onDigest(body, [...this.entries]);
      this.entries = [];
      this.lastDigestDate = dateKey;
    }
  }

  /** Schedule periodic tick checks (for real clocks). */
  start(intervalMs = 60_000): void {
    const tick = () => {
      this.tick();
      this.timerId = setTimeout(tick, intervalMs);
    };
    this.timerId = setTimeout(tick, intervalMs);
  }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

/** Date, hour, and minute on the wall clock of `timeZone` (an IANA name; invalid → system time). */
function wallClock(at: Date, timeZone: string): { date: string; hour: number; minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}
