import { z } from "zod";

/** Plan §4.1. All timestamps are ISO 8601 strings (UTC) at the contract layer; `store` maps them to SQLite integers (unix ms). */
const isoTimestamp = () => z.string().datetime({ offset: true });

/**
 * Engines OpenBot ships a driver for. The set is open (D-031): ACP agents the owner adds
 * are `acp-<slug>`, so an id is any short lowercase slug, not only one of these.
 */
export const BUILTIN_ENGINE_IDS = [
  "claude",
  "codex",
  "opencode",
  "cursor",
  "gemini",
  "grok",
  "fake",
] as const;
export const EngineId = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, "invalid engine id");
export type EngineId = z.infer<typeof EngineId>;

export const PermissionPreset = z.enum(["read_only", "workspace_write", "full"]);
export type PermissionPreset = z.infer<typeof PermissionPreset>;

export const ComputerAccess = z.enum(["none", "docker", "docker+local"]);
export type ComputerAccess = z.infer<typeof ComputerAccess>;

export const EngineRouting = z.object({
  mode: z.enum(["auto", "pinned"]),
  engine: EngineId.optional(),
  model: z.string().optional(),
  effort: z.enum(["low", "medium", "high"]).optional(),
});
export type EngineRouting = z.infer<typeof EngineRouting>;

export const EngineAuthOverride = z.object({
  claude: z.enum(["login", "api_key"]).optional(),
  codex: z.enum(["login", "api_key"]).optional(),
});
export type EngineAuthOverride = z.infer<typeof EngineAuthOverride>;

export const BotJustification = z.object({
  responsibility: z.string(),
  whyNotExisting: z.string(),
  lifetime: z.enum(["recurring", "project", "one_off"]),
  boundary: z.array(z.string()),
  userRequested: z.boolean(),
  spawnDecisionId: z.string(),
});
export type BotJustification = z.infer<typeof BotJustification>;

export const Bot = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  label: z.string().optional(),
  description: z.string(),
  avatar: z.string().optional(),
  pinned: z.boolean().default(false),
  hidden: z.boolean().default(false),
  isChiefOfStaff: z.boolean().default(false),
  createdBy: z.union([z.literal("user"), z.string()]),
  lastActiveAt: isoTimestamp().optional(),
  archivedAt: isoTimestamp().optional(),
  routing: EngineRouting,
  auth: EngineAuthOverride.optional(),
  permissionPreset: PermissionPreset,
  computer: ComputerAccess,
  connectors: z.array(z.string()),
  limits: z.object({
    dailyUsd: z.number().nonnegative().optional(),
    dailyTokens: z.number().int().nonnegative().optional(),
    /** Opt-in, off by default: skips a routine run's own per-run cost/token cap for this bot, so a long task isn't cut off mid-work. The routine's own perRun numbers still show in its settings; this only stops them from interrupting the turn. */
    unrestrictedRoutineBudget: z.boolean().optional(),
  }),
  justification: BotJustification.optional(),
});
export type Bot = z.infer<typeof Bot>;

export const Thread = z.object({
  id: z.string(),
  botId: z.string(),
  kind: z.literal("dm"),
  createdAt: isoTimestamp(),
});
export type Thread = z.infer<typeof Thread>;

export const MessageAuthor = z.object({
  type: z.enum(["user", "bot", "system", "routine"]),
  id: z.string().optional(),
});
export type MessageAuthor = z.infer<typeof MessageAuthor>;

export const MessageKind = z.enum(["result", "decision", "blocker"]);
export type MessageKind = z.infer<typeof MessageKind>;

export const MessageDelivery = z.enum(["delivered", "held", "merged"]);
export type MessageDelivery = z.infer<typeof MessageDelivery>;

export const Message = z.object({
  id: z.string(),
  threadId: z.string(),
  author: MessageAuthor,
  text: z.string(),
  attachments: z.array(z.string()),
  chainId: z.string().optional(),
  hop: z.number().int().nonnegative().default(0),
  replyTo: z.string().optional(),
  createdAt: isoTimestamp(),
  proactive: z.boolean().default(false),
  kind: MessageKind.optional(),
  options: z.array(z.string()).optional(),
  deadline: isoTimestamp().optional(),
  dedupeKey: z.string().optional(),
  delivery: MessageDelivery,
  pushed: z.boolean().default(false),
  notifyDecisionId: z.string().optional(),
  /** Set on the message that shows an `ask_user` form card. */
  inputRequestId: z.string().optional(),
});
export type Message = z.infer<typeof Message>;

export const ChainOrigin = z.enum(["user", "bot", "routine"]);
export type ChainOrigin = z.infer<typeof ChainOrigin>;

export const ChainMode = z.enum(["live", "dry_run"]);
export type ChainMode = z.infer<typeof ChainMode>;

export const ChainStatus = z.enum(["active", "paused", "stopped", "done"]);
export type ChainStatus = z.infer<typeof ChainStatus>;

export const Chain = z.object({
  id: z.string(),
  origin: ChainOrigin,
  mode: ChainMode,
  routineRunId: z.string().optional(),
  status: ChainStatus,
  /** Depth of routine-triggered-by-routine chains; max 2 per plan §4.1/WS12. */
  routineDepth: z.number().int().nonnegative().default(0),
  botMessages: z.number().int().nonnegative().default(0),
  turns: z.number().int().nonnegative().default(0),
  usd: z.number().nonnegative().default(0),
  tokens: z.number().int().nonnegative().default(0),
  computerSteps: z.number().int().nonnegative().default(0),
  wallMin: z.number().nonnegative().default(0),
  createdAt: isoTimestamp(),
});
export type Chain = z.infer<typeof Chain>;

export const TurnStatus = z.enum(["queued", "running", "completed", "failed", "interrupted"]);
export type TurnStatus = z.infer<typeof TurnStatus>;

export const TurnUsage = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  usd: z.number().nonnegative().default(0),
});
export type TurnUsage = z.infer<typeof TurnUsage>;

export const Turn = z.object({
  id: z.string(),
  botId: z.string(),
  chainId: z.string(),
  engine: EngineId,
  model: z.string(),
  effort: z.enum(["low", "medium", "high"]).optional(),
  routeDecisionId: z.string().optional(),
  sessionId: z.string().optional(),
  status: TurnStatus,
  usage: TurnUsage,
  createdAt: isoTimestamp(),
});
export type Turn = z.infer<typeof Turn>;

export const ApprovalKind = z.enum([
  "tool",
  "computer_action",
  "connector_action",
  "chain_limit",
  "bot_request",
  "local_computer",
  "routine_live",
]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const ApprovalStatus = z.enum(["pending", "resolved", "expired"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalResolution = z.enum(["allow", "deny", "expired"]).optional();

export const Approval = z.object({
  id: z.string(),
  kind: ApprovalKind,
  botId: z.string(),
  chainId: z.string().optional(),
  summary: z.string(),
  detail: z.string(),
  risk: z.number().min(0).max(1).optional(),
  status: ApprovalStatus,
  resolution: ApprovalResolution,
  expiresAt: isoTimestamp(),
  createdAt: isoTimestamp(),
});
export type Approval = z.infer<typeof Approval>;

export const RuleEffect = z.enum(["allow", "ask", "deny"]);
export type RuleEffect = z.infer<typeof RuleEffect>;

export const Rule = z.object({
  id: z.string(),
  scope: z.union([z.literal("global"), z.string()]),
  match: z.object({
    tool: z.string().optional(),
    computerOp: z.string().optional(),
    connectorAction: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
  effect: RuleEffect,
  source: z.enum(["builtin", "user", "preset"]),
  createdAt: isoTimestamp(),
});
export type Rule = z.infer<typeof Rule>;

export const DeviceRole = z.enum(["owner", "approver"]);
export type DeviceRole = z.infer<typeof DeviceRole>;

export const Device = z.object({
  id: z.string(),
  name: z.string(),
  role: DeviceRole,
  publicKey: z.string(),
  via: z.enum(["lan", "tailscale", "cloudflare"]),
  pairedAt: isoTimestamp(),
  lastSeenAt: isoTimestamp().optional(),
  revokedAt: isoTimestamp().optional(),
});
export type Device = z.infer<typeof Device>;

export const Connection = z.object({
  id: z.string(),
  provider: z.enum(["mcp"]),
  /** Catalogue id the connection was made from (`curated:…` or `registry:…`). */
  appId: z.string(),
  displayName: z.string(),
  status: z.enum(["connected", "disconnected", "error"]),
  toolMeta: z.record(z.string(), z.object({ sideEffect: z.boolean() })),
  triggers: z.array(z.string()),
  createdAt: isoTimestamp(),
});
export type Connection = z.infer<typeof Connection>;

export const ComputerTaskStatus = z.enum(["queued", "running", "escalated", "completed", "failed"]);
export type ComputerTaskStatus = z.infer<typeof ComputerTaskStatus>;

export const ComputerTask = z.object({
  id: z.string(),
  botId: z.string(),
  chainId: z.string(),
  goal: z.string(),
  provider: z.enum(["docker", "local", "fake"]),
  status: ComputerTaskStatus,
  steps: z.number().int().nonnegative().default(0),
  usd: z.number().nonnegative().default(0),
  createdAt: isoTimestamp(),
});
export type ComputerTask = z.infer<typeof ComputerTask>;

export const RoutineScheduleTrigger = z.object({
  type: z.literal("schedule"),
  cron: z.string().optional(),
  at: isoTimestamp().optional(),
  timezone: z.string(),
  catchUp: z.enum(["none", "last"]),
});
export type RoutineScheduleTrigger = z.infer<typeof RoutineScheduleTrigger>;

export const RoutineEventTrigger = z.object({
  type: z.literal("event"),
  source: z.enum(["connector", "webhook", "file", "openbot"]),
  connectionId: z.string().optional(),
  triggerSlug: z.string().optional(),
  path: z.string().optional(),
  eventType: z.string().optional(),
  filter: z.array(z.object({ path: z.string(), regex: z.string() })).optional(),
  matchInstructions: z.string().optional(),
});
export type RoutineEventTrigger = z.infer<typeof RoutineEventTrigger>;

export const RoutineTrigger = z.discriminatedUnion("type", [
  RoutineScheduleTrigger,
  RoutineEventTrigger,
]);
export type RoutineTrigger = z.infer<typeof RoutineTrigger>;

export const RoutineLimits = z.object({
  perRun: z.object({
    usd: z.number().nonnegative(),
    tokens: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    computerSteps: z.number().int().nonnegative(),
    wallMin: z.number().nonnegative(),
  }),
  dailyUsd: z.number().nonnegative(),
  maxRunsPerDay: z.number().int().nonnegative(),
  cooldownSec: z.number().int().nonnegative(),
});
export type RoutineLimits = z.infer<typeof RoutineLimits>;

export const Routine = z.object({
  id: z.string(),
  botId: z.string(),
  name: z.string(),
  prompt: z.string(),
  createdBy: z.union([z.literal("user"), z.string()]),
  enabled: z.boolean().default(true),
  liveApproved: z.boolean().default(false),
  trigger: RoutineTrigger,
  limits: RoutineLimits,
  pausedReason: z.string().optional(),
  consecutiveFailures: z.number().int().nonnegative().default(0),
  lastRunAt: isoTimestamp().optional(),
  createdAt: isoTimestamp(),
});
export type Routine = z.infer<typeof Routine>;

export const RoutineRunCause = z.enum(["schedule", "event", "manual", "test"]);
export type RoutineRunCause = z.infer<typeof RoutineRunCause>;

export const RoutineRunStatus = z.enum([
  "queued",
  "running",
  "done",
  "failed",
  "skipped",
  "capped",
]);
export type RoutineRunStatus = z.infer<typeof RoutineRunStatus>;

export const RoutineRun = z.object({
  id: z.string(),
  routineId: z.string(),
  chainId: z.string(),
  cause: RoutineRunCause,
  triggerEventIds: z.array(z.string()),
  dryRun: z.boolean(),
  status: RoutineRunStatus,
  skipReason: z.string().optional(),
  usage: TurnUsage,
  resultSummary: z.string().optional(),
  plannedActions: z.array(z.string()).optional(),
  startedAt: isoTimestamp().optional(),
  endedAt: isoTimestamp().optional(),
});
export type RoutineRun = z.infer<typeof RoutineRun>;

export const TriggerEvent = z.object({
  id: z.string(),
  source: z.string(),
  routineId: z.string(),
  payloadHash: z.string(),
  payloadRef: z.string(),
  matched: z.boolean(),
  matchDecisionId: z.string().optional(),
  receivedAt: isoTimestamp(),
});
export type TriggerEvent = z.infer<typeof TriggerEvent>;

export const EngineSession = z.object({
  id: z.string(),
  botId: z.string(),
  engine: EngineId,
  sessionId: z.string(),
  createdAt: isoTimestamp(),
  lastUsedAt: isoTimestamp(),
});
export type EngineSession = z.infer<typeof EngineSession>;

export const DecisionOutcome = z.enum(["allow", "deny", "ask", "n/a"]);
export type DecisionOutcome = z.infer<typeof DecisionOutcome>;

/**
 * `requestId` added per the Jev live-API spike recommendation (`internal/jev-spike.md`
 * §8): the only per-call support-correlation handle Jev returns
 * (`x-typesafe-request-id`), absent for llm/heuristic fallbacks.
 */
export const Decision = z.object({
  id: z.string(),
  purpose: z.string(),
  provider: z.enum(["jev", "llm", "heuristic"]),
  model: z.string(),
  stateHash: z.string(),
  answers: z.record(z.string(), z.unknown()),
  thresholds: z.record(z.string(), z.number()).optional(),
  band: z.enum(["auto", "confirm", "human"]),
  outcome: DecisionOutcome,
  feedback: z.enum(["promote", "mute"]).optional(),
  requestId: z.string().optional(),
  createdAt: isoTimestamp(),
});
export type Decision = z.infer<typeof Decision>;

export const CapCounter = z.object({
  id: z.string(),
  scope: z.string(),
  key: z.string(),
  windowStart: isoTimestamp(),
  windowSec: z.number().int().positive(),
  count: z.number().int().nonnegative(),
});
export type CapCounter = z.infer<typeof CapCounter>;

export const Settings = z.object({
  id: z.literal("singleton").default("singleton"),
  caps: z.record(z.string(), z.number()),
  budgets: z.record(z.string(), z.number()),
  quietHours: z.object({ enabled: z.boolean(), start: z.string(), end: z.string() }).optional(),
  updatedAt: isoTimestamp(),
});
export type Settings = z.infer<typeof Settings>;

export const SetupState = z.object({
  id: z.literal("singleton").default("singleton"),
  typesafe: z.object({ ok: z.boolean() }).optional(),
  claude: z.object({ ok: z.boolean(), mode: z.enum(["login", "api_key"]).optional() }).optional(),
  codex: z.object({ ok: z.boolean(), mode: z.enum(["login", "api_key"]).optional() }).optional(),
  tailscale: z.object({ ok: z.boolean() }).optional(),
  cloudflare: z.object({ ok: z.boolean() }).optional(),
  completedAt: isoTimestamp().optional(),
});
export type SetupState = z.infer<typeof SetupState>;

/**
 * A task one Bot handed to another (`send_message`). The runtime, not the model, decides its
 * state: a turn that ends completes, fails or interrupts it, and the requester is woken.
 */
export const DelegationState = z.enum([
  "submitted",
  "working",
  "input_required",
  "completed",
  "failed",
  "interrupted",
]);
export type DelegationState = z.infer<typeof DelegationState>;

export const Delegation = z.object({
  id: z.string(),
  chainId: z.string(),
  requesterBotId: z.string(),
  assigneeBotId: z.string(),
  /** The thread the human is talking in (the requester's); worker cards and results show there. */
  ownerThreadId: z.string(),
  title: z.string(),
  state: DelegationState,
  statusMessage: z.string().optional(),
  /** The assignee's closing text once the delegation ended. */
  result: z.string().optional(),
  /** The engine the assignee worked on: follow-up turns stay on it (its session lives there). */
  engine: z.string().optional(),
  /** Requester -> assignee messages; capped so two Bots can't ping-pong forever. */
  roundTrips: z.number().int().nonnegative(),
  /** A wake for the requester is owed; survives a restart until delivered. */
  wakePending: z.boolean(),
  wakeKind: z.string().optional(),
  createdAt: isoTimestamp(),
  updatedAt: isoTimestamp(),
  lastEventAt: isoTimestamp(),
});
export type Delegation = z.infer<typeof Delegation>;
