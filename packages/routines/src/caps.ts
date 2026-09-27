import type { Routine } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import { O7_GUARDRAILS } from "./defaults.js";

const DAY_SEC = 86_400;

export type CapCheckResult = { allowed: true } | { allowed: false; reason: string };

/** Pre-run budget checks (plan §5 WS12 spend caps O7). */
export function checkRunCaps(
  ctx: CoreContext,
  routine: Routine,
  dryRun: boolean,
): CapCheckResult {
  const currentRuns = ctx.repos.capCounters.get("routine", `${routine.id}:runs`);
  const todayCount = currentRuns?.count ?? 0;

  if (todayCount >= routine.limits.maxRunsPerDay) {
    return { allowed: false, reason: "maxRunsPerDay reached" };
  }

  const dailySpend = ctx.repos.capCounters.get("routine", `${routine.id}:usd`);
  if (dailySpend && dailySpend.count / 100 >= routine.limits.dailyUsd) {
    return { allowed: false, reason: "routine dailyUsd cap reached" };
  }

  const bot = ctx.repos.bots.getById(routine.botId);
  if (bot?.limits.dailyUsd !== undefined) {
    const botSpend = ctx.repos.capCounters.get("bot", `${routine.botId}:usd`);
    const botUsd = (botSpend?.count ?? 0) / 100;
    if (botUsd + routine.limits.perRun.usd > bot.limits.dailyUsd) {
      return { allowed: false, reason: "bot daily spend cap insufficient for per-run budget" };
    }
  }

  const globalCap = ctx.repos.settings.get()?.caps?.global_daily_usd;
  if (globalCap !== undefined) {
    const globalSpend = ctx.repos.capCounters.get("global", "usd");
    const globalUsd = (globalSpend?.count ?? 0) / 100;
    if (globalUsd + routine.limits.perRun.usd > globalCap) {
      return { allowed: false, reason: "global daily spend cap insufficient" };
    }
  }

  if (!dryRun && !routine.liveApproved) {
    const hasCompletedDryRun = ctx.repos.routineRuns
      .listByRoutine(routine.id)
      .some((run) => run.dryRun && run.status === "done");
    if (!hasCompletedDryRun) {
      return { allowed: false, reason: "first run must be dry run" };
    }
    return { allowed: false, reason: "live not approved" };
  }

  return { allowed: true };
}

/** O7 routine count guardrails. */
export function checkRoutineCreationCaps(ctx: CoreContext, botId: string): CapCheckResult {
  const total = ctx.repos.routines.list().length;
  if (total >= O7_GUARDRAILS.maxRoutinesTotal) {
    return { allowed: false, reason: `max ${O7_GUARDRAILS.maxRoutinesTotal} routines total` };
  }
  const perBot = ctx.repos.routines.listByBot(botId).length;
  if (perBot >= O7_GUARDRAILS.maxRoutinesPerBot) {
    return { allowed: false, reason: `max ${O7_GUARDRAILS.maxRoutinesPerBot} routines per bot` };
  }
  return { allowed: true };
}

/** Record spend after a completed run (counts toward bot/global caps). */
export function recordRunSpend(ctx: CoreContext, routine: Routine, usd: number): void {
  const now = ctx.clock.now();
  const cents = Math.round(usd * 100);
  ctx.repos.capCounters.incrementInWindow("routine", `${routine.id}:usd`, DAY_SEC, now, cents);
  ctx.repos.capCounters.incrementInWindow("bot", `${routine.botId}:usd`, DAY_SEC, now, cents);
  ctx.repos.capCounters.incrementInWindow("global", "usd", DAY_SEC, now, cents);
}

/** Increment daily run counter after a run is actually started. */
export function recordRunStarted(ctx: CoreContext, routineId: string): void {
  const now = ctx.clock.now();
  ctx.repos.capCounters.incrementInWindow("routine", `${routineId}:runs`, DAY_SEC, now, 1);
}
