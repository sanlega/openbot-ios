import type { DecisionService, JevAnswer } from "@openbot/contracts";
import { buildDecisionState, buildNotifyQuestions, markUntrusted } from "@openbot/decisions";
import type { CapCounterService } from "./caps.js";
import { DEFAULT_NOTIFY_THRESHOLDS } from "./thresholds.js";
import type {
  AutonomyCaps,
  GateRefusal,
  GateResult,
  NotifyGateContext,
  NotifyGateDetails,
  NotifyThresholds,
} from "./types.js";

function noul(answers: Record<string, JevAnswer>, id: string): number {
  const a = answers[id];
  if (a?.type === "noul") return a.noul;
  return 0;
}

/**
 * Research §11.3 notify rule: deliver only if
 * max(is_final_result, needs_user_decision, is_blocker) >= deliverMin
 * and is_duplicate_or_noise <= noiseMax.
 */
export function evaluateNotifyRule(
  answers: Record<string, JevAnswer>,
  thresholds: NotifyThresholds = DEFAULT_NOTIFY_THRESHOLDS,
): { deliver: boolean; push: boolean } {
  const isFinalResult = noul(answers, "is_final_result");
  const needsUserDecision = noul(answers, "needs_user_decision");
  const isBlocker = noul(answers, "is_blocker");
  const isDuplicateOrNoise = noul(answers, "is_duplicate_or_noise");
  const isTimeSensitive = noul(answers, "is_time_sensitive");

  const deliverScore = Math.max(isFinalResult, needsUserDecision, isBlocker);
  const deliver =
    deliverScore >= thresholds.deliverMin && isDuplicateOrNoise <= thresholds.noiseMax;
  const push = deliver && isTimeSensitive >= thresholds.timeSensitiveMin;

  return { deliver, push };
}

export interface NotifyGateOptions {
  decisions: DecisionService;
  caps: CapCounterService;
  autonomyCaps: AutonomyCaps;
  thresholds?: NotifyThresholds;
}

export class NotifyGate {
  private readonly decisions: DecisionService;
  private readonly caps: CapCounterService;
  private readonly autonomyCaps: AutonomyCaps;
  private readonly thresholds: NotifyThresholds;

  constructor(options: NotifyGateOptions) {
    this.decisions = options.decisions;
    this.caps = options.caps;
    this.autonomyCaps = options.autonomyCaps;
    this.thresholds = options.thresholds ?? DEFAULT_NOTIFY_THRESHOLDS;
  }

  private checkCaps(ctx: NotifyGateContext): GateRefusal | null {
    const conservative = ctx.conservativeMode ?? false;

    const capCheck = this.caps.checkNotifyCaps(
      ctx.botId,
      this.autonomyCaps,
      {
        botHour: ctx.proactiveCountBotHour,
        botDay: ctx.proactiveCountBotDay,
        globalHour: ctx.proactiveCountGlobalHour,
      },
      conservative,
    );
    if (!capCheck.ok) {
      return { allowed: false, reason: capCheck.reason!, suggestion: "wait for digest" };
    }

    if (this.caps.hasRecentDedupe(ctx.message.dedupeKey, ctx.recentDelivered, this.autonomyCaps, ctx.now)) {
      return {
        allowed: false,
        reason: `duplicate dedupe_key "${ctx.message.dedupeKey}" within ${this.autonomyCaps.dedupeWindowHours}h`,
        suggestion: "logged, not delivered",
      };
    }

    const quiet = this.autonomyCaps.quietHours ?? ctx.quietHours;
    if (this.caps.isQuietHours(quiet, ctx.now)) {
      // Held during quiet hours unless time-sensitive (checked after Jev).
      // We don't refuse here — Jev decides time sensitivity.
    }

    return null;
  }

  async evaluate(ctx: NotifyGateContext): Promise<GateResult<NotifyGateDetails>> {
    if (this.caps.inMergeWindow(ctx.lastMessageFromBotAt, this.autonomyCaps, ctx.now)) {
      return {
        allowed: true,
        decisionId: "merged",
        details: { outcome: "merged", push: false },
      };
    }

    const capRefusal = this.checkCaps(ctx);
    if (capRefusal) {
      return capRefusal;
    }

    const state = buildDecisionState({
      message: {
        kind: ctx.message.kind,
        body: markUntrusted(ctx.message.body),
        dedupe_key: ctx.message.dedupeKey,
        options: ctx.message.options,
        deadline: ctx.message.deadline,
      },
      bot_task: ctx.botTask ? markUntrusted(ctx.botTask) : undefined,
      recent_delivered: ctx.recentDelivered.map((m) => ({
        bot_id: m.botId,
        body: markUntrusted(m.body),
        dedupe_key: m.dedupeKey,
        at: m.at.toISOString(),
      })),
    });

    const result = await this.decisions.decide({
      purpose: "notify",
      state,
      questions: buildNotifyQuestions(),
    });

    const { deliver: ruleDeliver, push } = evaluateNotifyRule(result.answers, this.thresholds);

    const quiet = this.autonomyCaps.quietHours ?? ctx.quietHours;
    const deliver =
      ruleDeliver && !(this.caps.isQuietHours(quiet, ctx.now) && !push);

    if (!deliver) {
      return {
        allowed: false,
        reason: "message held: does not meet notify gate criteria",
        suggestion: "logged, not delivered",
      };
    }

    return {
      allowed: true,
      decisionId: result.decisionId,
      details: { outcome: "delivered", push },
    };
  }
}
