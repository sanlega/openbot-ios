import { createHash } from "node:crypto";
import { bandNoul, type Clock, type DecisionService } from "@openbot/contracts";
import type { ChainManager } from "./chain.js";
import type { EventSink } from "./event-sink.js";

/** Plan §5 WS2 "Loop protection": bot-pair rate limiting, repeated-content detection, and the Jev `loop` gate — on top of `ChainManager`'s hard numeric limits. */
export interface LoopGuardOptions {
  events: EventSink;
  chains: ChainManager;
  decisions: DecisionService;
  clock: Clock;
  /** Messages allowed between the same ordered Bot pair, in `pairWindowMs`, before the guard trips. */
  maxMessagesPerPairPerWindow?: number;
  pairWindowMs?: number;
  /** Consecutive identical-content messages between the same pair before the guard trips. */
  maxRepeatedContent?: number;
}

export interface GuardCheckInput {
  chainId: string;
  fromBotId: string;
  toBotId: string;
  text: string;
}

export interface GuardResult {
  tripped: boolean;
  reason?: string;
}

const DEFAULT_MAX_PER_WINDOW = 5;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REPEATED = 3;

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Length of the run of identical hashes at the end of `history` (1 if the last entry has no immediate repeat). */
function trailingRepeatCount(history: string[]): number {
  if (history.length === 0) return 0;
  const last = history[history.length - 1];
  let count = 0;
  for (let i = history.length - 1; i >= 0 && history[i] === last; i--) count++;
  return count;
}

/**
 * Loop protection beyond hard numeric chain limits (plan §5 WS2 acceptance:
 * "Looping fake Bots get paused"). Every bot-to-bot message passes through
 * {@link LoopGuards.check}; a trip pauses the chain via `ChainManager` with a
 * `guard.tripped` event, distinct from `chain.limit_reached`.
 */
export class LoopGuards {
  private readonly pairTimestampsMs = new Map<string, number[]>();
  private readonly recentContentHashes = new Map<string, string[]>();

  constructor(private readonly opts: LoopGuardOptions) {}

  async check(input: GuardCheckInput): Promise<GuardResult> {
    const pairKey = `${input.chainId}:${input.fromBotId}->${input.toBotId}`;
    const rateResult = this.checkRate(pairKey, input.chainId);
    if (rateResult.tripped) return rateResult;

    const contentResult = this.checkRepeatedContent(pairKey, input.chainId, input.text);
    if (contentResult.tripped) return contentResult;

    return this.checkJevLoopGate(input);
  }

  private checkRate(pairKey: string, chainId: string): GuardResult {
    const now = this.opts.clock.now().getTime();
    const windowMs = this.opts.pairWindowMs ?? DEFAULT_WINDOW_MS;
    const maxPerWindow = this.opts.maxMessagesPerPairPerWindow ?? DEFAULT_MAX_PER_WINDOW;
    const timestamps = (this.pairTimestampsMs.get(pairKey) ?? []).filter((t) => now - t < windowMs);
    timestamps.push(now);
    this.pairTimestampsMs.set(pairKey, timestamps);
    if (timestamps.length > maxPerWindow) {
      return this.trip(chainId, `bot pair rate limit exceeded (${timestamps.length}/${maxPerWindow} in ${windowMs}ms)`);
    }
    return { tripped: false };
  }

  private checkRepeatedContent(pairKey: string, chainId: string, text: string): GuardResult {
    const maxRepeated = this.opts.maxRepeatedContent ?? DEFAULT_MAX_REPEATED;
    const history = this.recentContentHashes.get(pairKey) ?? [];
    history.push(hashText(text));
    this.recentContentHashes.set(pairKey, history);
    const repeats = trailingRepeatCount(history);
    if (repeats >= maxRepeated) {
      return this.trip(chainId, `repeated content detected (${repeats}x consecutive)`);
    }
    return { tripped: false };
  }

  private async checkJevLoopGate(input: GuardCheckInput): Promise<GuardResult> {
    const decision = await this.opts.decisions.decide({
      purpose: "loop",
      state: {
        chainId: input.chainId,
        fromBotId: input.fromBotId,
        toBotId: input.toBotId,
        text: input.text,
      },
      questions: {
        likely_loop: {
          type: "noul",
          instructions:
            "Is this bot-to-bot exchange a repetitive loop with no real progress, rather than genuine delegated work?",
        },
      },
    });
    const answer = decision.answers.likely_loop;
    if (answer?.type === "noul") {
      const band = bandNoul(answer.noul);
      if (band === "human" && answer.noul > 0.5) {
        return this.trip(
          input.chainId,
          `Jev loop gate: likely_loop=${answer.noul.toFixed(2)} (band=human)`,
        );
      }
    }
    return { tripped: false };
  }

  private trip(chainId: string, reason: string): GuardResult {
    this.opts.chains.pause(chainId, "guard.tripped", { reason });
    return { tripped: true, reason };
  }
}
