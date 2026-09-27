import type { Clock } from "@openbot/contracts";
import type { EventSink } from "./event-sink.js";
import type { NotifyGate } from "./notify-gate.js";

export interface SpendTotals {
  usd: number;
  tokens: number;
}

/** Per-day spend ledger (plan §5 WS2 S8: "Scope: per turn, per Bot per day, and global"). */
export interface SpendLedger {
  add(scope: "bot" | "global", key: string, dayKey: string, usage: SpendTotals): SpendTotals;
  get(scope: "bot" | "global", key: string, dayKey: string): SpendTotals;
}

export class InMemorySpendLedger implements SpendLedger {
  private readonly totals = new Map<string, SpendTotals>();

  private mapKey(scope: string, key: string, dayKey: string): string {
    return `${scope}:${key}:${dayKey}`;
  }

  add(scope: "bot" | "global", key: string, dayKey: string, usage: SpendTotals): SpendTotals {
    const mapKey = this.mapKey(scope, key, dayKey);
    const prev = this.totals.get(mapKey) ?? { usd: 0, tokens: 0 };
    const next = { usd: prev.usd + usage.usd, tokens: prev.tokens + usage.tokens };
    this.totals.set(mapKey, next);
    return next;
  }

  get(scope: "bot" | "global", key: string, dayKey: string): SpendTotals {
    return this.totals.get(this.mapKey(scope, key, dayKey)) ?? { usd: 0, tokens: 0 };
  }
}

export interface SpendCapsOptions {
  ledger: SpendLedger;
  notify: NotifyGate;
  events: EventSink;
  clock: Clock;
}

export interface SpendCheckInput {
  botId: string;
  chainId?: string;
  /** Whether to send the one blocker message to the user via `NotifyGate` when a cap is hit (needs a resolvable thread; defaults `true`). */
  sendBlocker?: boolean;
  dailyUsdPerBot?: number;
  dailyUsdGlobal?: number;
}

export interface SpendCheckResult {
  allowed: boolean;
  reason?: string;
  scope?: "bot" | "global";
}

/**
 * Spend and turn caps (plan §5 WS2 S8). Checked before each turn
 * ({@link checkBeforeTurn}) and on every usage event
 * ({@link recordUsage}); at a Bot's cap, the Bot pauses (the caller stops
 * scheduling new turns for it — this class only decides `allowed`/not, it
 * doesn't own the Bot's own "paused" flag) and sends exactly one blocker
 * message per Bot per day through the `NotifyGate`, as `kind: 'blocker'`.
 */
export class SpendCaps {
  private readonly blockerSentOnDay = new Set<string>();

  constructor(private readonly opts: SpendCapsOptions) {}

  private dayKey(): string {
    return this.opts.clock.now().toISOString().slice(0, 10);
  }

  /** Remaining USD budget for this Bot right now — the minimum of its own daily cap and what's left of the global cap. Callers use this to size a turn's `TurnInput.limits.maxUsd`. */
  remainingUsd(
    botId: string,
    dailyUsdPerBot?: number,
    dailyUsdGlobal?: number,
  ): number | undefined {
    const day = this.dayKey();
    const remaining: number[] = [];
    if (dailyUsdPerBot !== undefined) {
      remaining.push(Math.max(0, dailyUsdPerBot - this.opts.ledger.get("bot", botId, day).usd));
    }
    if (dailyUsdGlobal !== undefined) {
      remaining.push(
        Math.max(0, dailyUsdGlobal - this.opts.ledger.get("global", "global", day).usd),
      );
    }
    return remaining.length > 0 ? Math.min(...remaining) : undefined;
  }

  async checkBeforeTurn(input: SpendCheckInput): Promise<SpendCheckResult> {
    const day = this.dayKey();
    if (input.dailyUsdPerBot !== undefined) {
      const total = this.opts.ledger.get("bot", input.botId, day).usd;
      if (total >= input.dailyUsdPerBot) {
        await this.trip(
          input,
          "bot",
          `daily spend cap reached ($${input.dailyUsdPerBot.toFixed(2)}/day)`,
        );
        return { allowed: false, reason: "bot daily spend cap reached", scope: "bot" };
      }
    }
    if (input.dailyUsdGlobal !== undefined) {
      const total = this.opts.ledger.get("global", "global", day).usd;
      if (total >= input.dailyUsdGlobal) {
        await this.trip(
          input,
          "global",
          `global daily spend cap reached ($${input.dailyUsdGlobal.toFixed(2)}/day)`,
        );
        return { allowed: false, reason: "global daily spend cap reached", scope: "global" };
      }
    }
    return { allowed: true };
  }

  async recordUsage(input: {
    botId: string;
    chainId?: string;
    usd: number;
    tokens: number;
    sendBlocker?: boolean;
    dailyUsdPerBot?: number;
    dailyUsdGlobal?: number;
  }): Promise<SpendCheckResult> {
    const day = this.dayKey();
    const botTotal = this.opts.ledger.add("bot", input.botId, day, {
      usd: input.usd,
      tokens: input.tokens,
    });
    const globalTotal = this.opts.ledger.add("global", "global", day, {
      usd: input.usd,
      tokens: input.tokens,
    });
    this.opts.events.emit({
      ts: this.opts.clock.now().toISOString(),
      type: "usage.recorded",
      botId: input.botId,
      chainId: input.chainId,
      payload: {
        usd: input.usd,
        tokens: input.tokens,
        botDailyUsd: botTotal.usd,
        globalDailyUsd: globalTotal.usd,
      },
    });
    if (input.dailyUsdPerBot !== undefined && botTotal.usd >= input.dailyUsdPerBot) {
      await this.trip(
        input,
        "bot",
        `daily spend cap reached ($${input.dailyUsdPerBot.toFixed(2)}/day)`,
      );
      return { allowed: false, reason: "bot daily spend cap reached", scope: "bot" };
    }
    if (input.dailyUsdGlobal !== undefined && globalTotal.usd >= input.dailyUsdGlobal) {
      await this.trip(
        input,
        "global",
        `global daily spend cap reached ($${input.dailyUsdGlobal.toFixed(2)}/day)`,
      );
      return { allowed: false, reason: "global daily spend cap reached", scope: "global" };
    }
    return { allowed: true };
  }

  private async trip(
    input: { botId: string; chainId?: string; sendBlocker?: boolean },
    scope: "bot" | "global",
    reason: string,
  ): Promise<void> {
    this.opts.events.emit({
      ts: this.opts.clock.now().toISOString(),
      type: "cap.hit",
      botId: input.botId,
      chainId: input.chainId,
      payload: { scope, reason },
    });
    const blockerKey = `${input.botId}:${this.dayKey()}`;
    if (input.sendBlocker === false || this.blockerSentOnDay.has(blockerKey)) return;
    this.blockerSentOnDay.add(blockerKey);
    await this.opts.notify.notify({
      botId: input.botId,
      chainId: input.chainId,
      kind: "blocker",
      body: `I've paused for today — ${reason}.`,
    });
  }
}
