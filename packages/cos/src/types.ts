import type { Bot, BotJustification, MessageKind } from "@openbot/contracts";

/** Plan §4.9 `create_bot` tool input (CoS only). */
export interface CreateBotInput {
  name: string;
  description: string;
  responsibility: string;
  whyNotExisting: string;
  lifetime: "recurring" | "project" | "one_off";
  boundary: string[];
  userRequested: boolean;
}

/** Plan §4.9 `message_user` tool input. */
export interface MessageUserInput {
  kind: MessageKind;
  body: string;
  options?: string[];
  deadline?: string;
  dedupeKey: string;
}

/** Structured refusal from a gate or cap (plan §4.9). */
export interface GateRefusal {
  allowed: false;
  reason: string;
  suggestion: string;
}

export type NotifyOutcome = "delivered" | "held" | "merged";

export interface GateAllow<T extends Record<string, unknown> = Record<string, unknown>> {
  allowed: true;
  decisionId: string;
  /** Extra fields depend on the gate (e.g. push, mergedInto). */
  details?: T;
}

export type GateResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | GateRefusal
  | GateAllow<T>;

export interface NotifyGateDetails extends Record<string, unknown> {
  outcome: NotifyOutcome;
  push: boolean;
  mergedIntoMessageId?: string;
}

export interface SpawnGateContext {
  request: CreateBotInput;
  roster: Bot[];
  recentUserMessages: string[];
  cosCreatedBotCount: number;
  lastSpawnAt?: Date;
  spawnsInLast24h: number;
}

export interface NotifyGateContext {
  botId: string;
  message: MessageUserInput;
  botTask?: string;
  recentDelivered: Array<{ dedupeKey?: string; body: string; botId: string; at: Date }>;
  proactiveCountBotHour: number;
  proactiveCountBotDay: number;
  proactiveCountGlobalHour: number;
  lastMessageFromBotAt?: Date;
  quietHours?: { enabled: boolean; start: string; end: string };
  now: Date;
  /** When Jev is unavailable, caps are halved (research §11.3). */
  conservativeMode?: boolean;
}

export interface SpawnThresholds {
  userRequestedMin: number;
  routeConfidenceMin: number;
  existingCanDoMax: number;
  oneOffMax: number;
  duplicatesExistingMax: number;
  recurringOwnershipMin: number;
  distinctBoundaryMin: number;
}

export interface NotifyThresholds {
  deliverMin: number;
  noiseMax: number;
  timeSensitiveMin: number;
}

export interface AutonomyCaps {
  /** S1: max CoS-created bots in roster. */
  cosCreatedBotsMax: number;
  /** S2: new bots per rolling 24 h. */
  newBotsPerDay: number;
  /** S3: cooldown between spawns (minutes). */
  spawnCooldownMin: number;
  /** S4: proactive messages per bot per hour. */
  proactivePerBotHour: number;
  /** S4: proactive messages per bot per day. */
  proactivePerBotDay: number;
  /** S5: proactive messages across all bots per hour. */
  proactiveGlobalHour: number;
  /** S6: duplicate window per dedupe_key (hours). */
  dedupeWindowHours: number;
  /** S7: quiet hours (optional). */
  quietHours?: { enabled: boolean; start: string; end: string };
  /** S9: idle bot review threshold (days). */
  idleBotReviewDays: number;
  /** S10: merge window (minutes). */
  mergeWindowMin: number;
  /** Default digest hour (0-23, local time). */
  digestHour: number;
  /** Minimum hours before follow-up on unanswered questions (prompt placeholder). */
  followupMinHours: number;
}

export interface BotWhyPanel {
  bot: Bot;
  justification: BotJustification;
  spawnProbabilities: Record<string, number>;
}

export type PipelineAction =
  | { action: "answer_from_db"; reply: string }
  | { action: "delegate"; botId: string; hint?: string }
  | { action: "wake_cos"; reason: string }
  | { action: "stop" };

export interface DigestEntry {
  kind: "silent_completion" | "held_message" | "routine_result" | "archive_candidate";
  summary: string;
  botId?: string;
  botName?: string;
  at: Date;
}

export interface DigestConfig {
  hour: number;
  minute: number;
  timezone: string;
}
