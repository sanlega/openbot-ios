import type { DecisionService, JevAnswer } from "@openbot/contracts";
import { buildDecisionState, buildSpawnQuestions, markUntrusted } from "@openbot/decisions";
import type { CapCounterService } from "./caps.js";
import { DEFAULT_SPAWN_THRESHOLDS } from "./thresholds.js";
import type {
  GateRefusal,
  GateResult,
  SpawnGateContext,
  SpawnThresholds,
  AutonomyCaps,
} from "./types.js";

function noul(answers: Record<string, JevAnswer>, id: string): number {
  const a = answers[id];
  if (a?.type === "noul") return a.noul;
  return 0;
}

function choiceAnswer(answers: Record<string, JevAnswer>, id: string): { choice: string; confidence: number } {
  const a = answers[id];
  if (a?.type === "choice") return { choice: a.choice, confidence: a.confidence };
  return { choice: "", confidence: 0 };
}

/**
 * Research §11.2 spawn gate: S1–S3 caps, then Jev questions, then the code rule.
 * Uncertain middle band is denied without asking the user.
 */
export function evaluateSpawnRule(
  answers: Record<string, JevAnswer>,
  thresholds: SpawnThresholds = DEFAULT_SPAWN_THRESHOLDS,
): { allow: boolean; suggestion: string | null } {
  const route = choiceAnswer(answers, "route");
  const userRequested = noul(answers, "user_requested");
  const existingCanDo = noul(answers, "existing_can_do");
  const oneOff = noul(answers, "one_off");
  const recurringOwnership = noul(answers, "recurring_ownership");
  const distinctBoundary = noul(answers, "distinct_boundary");
  const duplicatesExisting = noul(answers, "duplicates_existing");

  const allow =
    userRequested >= thresholds.userRequestedMin ||
    (route.choice === "new_bot" &&
      route.confidence >= thresholds.routeConfidenceMin &&
      existingCanDo <= thresholds.existingCanDoMax &&
      oneOff <= thresholds.oneOffMax &&
      duplicatesExisting <= thresholds.duplicatesExistingMax &&
      (recurringOwnership >= thresholds.recurringOwnershipMin ||
        distinctBoundary >= thresholds.distinctBoundaryMin));

  const suggestion = allow
    ? null
    : route.choice === "new_bot"
      ? "cos_itself"
      : route.choice;

  return { allow, suggestion };
}

export interface SpawnGateOptions {
  decisions: DecisionService;
  caps: CapCounterService;
  autonomyCaps: AutonomyCaps;
  thresholds?: SpawnThresholds;
  now?: Date;
}

export class SpawnGate {
  private readonly decisions: DecisionService;
  private readonly caps: CapCounterService;
  private readonly autonomyCaps: AutonomyCaps;
  private readonly thresholds: SpawnThresholds;
  private readonly now: Date;

  constructor(options: SpawnGateOptions) {
    this.decisions = options.decisions;
    this.caps = options.caps;
    this.autonomyCaps = options.autonomyCaps;
    this.thresholds = options.thresholds ?? DEFAULT_SPAWN_THRESHOLDS;
    this.now = options.now ?? new Date();
  }

  private rosterCriteria(roster: SpawnGateContext["roster"]): Record<string, string> {
    const criteria: Record<string, string> = {};
    for (const bot of roster) {
      criteria[bot.slug] = bot.description;
    }
    return criteria;
  }

  private checkCaps(ctx: SpawnGateContext): GateRefusal | null {
    const s1 = this.caps.checkRosterCap(ctx.cosCreatedBotCount, this.autonomyCaps);
    if (!s1.ok) {
      return { allowed: false, reason: s1.reason!, suggestion: "reuse or ask the user to archive a bot" };
    }

    if (ctx.spawnsInLast24h >= this.autonomyCaps.newBotsPerDay) {
      return {
        allowed: false,
        reason: `daily spawn cap reached (${ctx.spawnsInLast24h}/${this.autonomyCaps.newBotsPerDay} in 24h)`,
        suggestion: "cos_itself",
      };
    }

    const s3 = this.caps.checkSpawnCooldown(ctx.lastSpawnAt, this.autonomyCaps, this.now);
    if (!s3.ok) {
      return { allowed: false, reason: s3.reason!, suggestion: "cos_itself" };
    }

    return null;
  }

  async evaluate(ctx: SpawnGateContext): Promise<GateResult> {
    const capRefusal = this.checkCaps(ctx);
    if (capRefusal) return capRefusal;

    const rosterCriteria = this.rosterCriteria(ctx.roster);
    const questions = buildSpawnQuestions(rosterCriteria);
    const state = buildDecisionState({
      roster: ctx.roster.map((b) => ({
        name: b.name,
        slug: b.slug,
        description: b.description,
        status: b.archivedAt ? "archived" : "active",
      })),
      recent_user_messages: ctx.recentUserMessages.map(markUntrusted),
      request: {
        name: ctx.request.name,
        description: ctx.request.description,
        responsibility: ctx.request.responsibility,
        why_not_existing: ctx.request.whyNotExisting,
        lifetime: ctx.request.lifetime,
        boundary: ctx.request.boundary,
        user_requested: ctx.request.userRequested,
      },
      user_requested: ctx.request.userRequested,
    });

    const result = await this.decisions.decide({
      purpose: "spawn",
      state,
      questions,
    });

    const { allow, suggestion } = evaluateSpawnRule(result.answers, this.thresholds);

    if (!allow) {
      const route = choiceAnswer(result.answers, "route");
      const delegateTarget =
        suggestion && suggestion !== "cos_itself" && suggestion !== "new_bot" ? suggestion : undefined;
      return {
        allowed: false,
        reason: delegateTarget
          ? `spawn denied: delegate to existing bot "${delegateTarget}"`
          : "spawn denied: handle it yourself or delegate to an existing bot",
        suggestion: suggestion ?? (route.choice !== "new_bot" ? route.choice : "cos_itself"),
      };
    }

    return { allowed: true, decisionId: result.decisionId };
  }
}
