import type { RoutineLimits } from "@openbot/contracts";

/** Plan §2.2 O7 per-run defaults. */
export const DEFAULT_PER_RUN_LIMITS: RoutineLimits["perRun"] = {
  usd: 0.5,
  tokens: 200_000,
  turns: 10,
  computerSteps: 50,
  wallMin: 15,
};

/** Plan §2.2 O7 per-routine defaults. */
export const DEFAULT_ROUTINE_LIMITS: RoutineLimits = {
  perRun: DEFAULT_PER_RUN_LIMITS,
  dailyUsd: 2,
  maxRunsPerDay: 24,
  cooldownSec: 60,
};

/** Plan §2.2 O7 guardrails. */
export const O7_GUARDRAILS = {
  maxRoutinesPerBot: 10,
  maxRoutinesTotal: 30,
  minScheduleIntervalMin: 15,
  eventCooldownSec: 60,
  maxConsecutiveFailures: 3,
  userAbsencePauseDays: 14,
  maxQueuedEventsPerRun: 20,
  maxRoutineDepth: 2,
  runHistoryLimit: 50,
  triggerEventRetentionDays: 7,
} as const;

/** Webhook rate limit (plan §5 WS12): 60 per minute per routine. */
export const WEBHOOK_RATE_LIMIT_PER_MIN = 60;
