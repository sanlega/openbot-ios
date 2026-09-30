import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import type {
  EngineRouting,
  EngineAuthOverride,
  BotJustification,
  MessageAuthor,
  RoutineTrigger,
  RoutineLimits,
  TurnUsage,
  InputField,
  InputAnswer,
} from "@openbot/contracts";

/**
 * Initial migration (`migrations/0000_init.sql`, plan §5 WS0): every v1 table. Schema
 * changes after this migration lands need a new numbered migration + a
 * coordinator-reviewed PR (plan's WS0 rule) — never edit this file's shipped columns
 * in place once `0000` has been generated.
 *
 * JSON columns are stored as TEXT (`{ mode: "json" }`); booleans as INTEGER 0/1
 * (SQLite has no boolean type); timestamps as INTEGER unix-ms (`{ mode: "timestamp_ms" }`).
 */

export const bots = sqliteTable("bots", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  label: text("label"),
  description: text("description").notNull(),
  avatar: text("avatar"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  isChiefOfStaff: integer("is_chief_of_staff", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").notNull(),
  lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" }),
  archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
  routing: text("routing", { mode: "json" }).notNull().$type<EngineRouting>(),
  auth: text("auth", { mode: "json" }).$type<EngineAuthOverride>(),
  permissionPreset: text("permission_preset").notNull(),
  computer: text("computer").notNull(),
  connectors: text("connectors", { mode: "json" }).notNull().$type<string[]>(),
  dailyUsd: real("daily_usd"),
  dailyTokens: integer("daily_tokens"),
  unrestrictedRoutineBudget: integer("unrestricted_routine_budget", { mode: "boolean" })
    .notNull()
    .default(false),
  justification: text("justification", { mode: "json" }).$type<BotJustification>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id").notNull(),
    kind: text("kind").notNull().default("dm"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("threads_bot_id_idx").on(t.botId)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    author: text("author", { mode: "json" }).notNull().$type<MessageAuthor>(),
    text: text("text").notNull(),
    attachments: text("attachments", { mode: "json" }).notNull().$type<string[]>(),
    chainId: text("chain_id"),
    hop: integer("hop").notNull().default(0),
    replyTo: text("reply_to"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    proactive: integer("proactive", { mode: "boolean" }).notNull().default(false),
    kind: text("kind"),
    options: text("options", { mode: "json" }).$type<string[]>(),
    deadline: integer("deadline", { mode: "timestamp_ms" }),
    dedupeKey: text("dedupe_key"),
    delivery: text("delivery").notNull(),
    pushed: integer("pushed", { mode: "boolean" }).notNull().default(false),
    notifyDecisionId: text("notify_decision_id"),
    inputRequestId: text("input_request_id"),
  },
  (t) => [
    index("messages_thread_id_idx").on(t.threadId),
    index("messages_dedupe_key_idx").on(t.dedupeKey),
  ],
);

export const inputRequests = sqliteTable(
  "input_requests",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id").notNull(),
    threadId: text("thread_id").notNull(),
    chainId: text("chain_id"),
    title: text("title").notNull(),
    intro: text("intro"),
    fields: text("fields", { mode: "json" }).notNull().$type<InputField[]>(),
    status: text("status").notNull(),
    answers: text("answers", { mode: "json" }).$type<Record<string, InputAnswer>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("input_requests_bot_id_idx").on(t.botId),
    index("input_requests_status_idx").on(t.status),
  ],
);

export const chains = sqliteTable("chains", {
  id: text("id").primaryKey(),
  origin: text("origin").notNull(),
  mode: text("mode").notNull(),
  routineRunId: text("routine_run_id"),
  status: text("status").notNull(),
  routineDepth: integer("routine_depth").notNull().default(0),
  botMessages: integer("bot_messages").notNull().default(0),
  turns: integer("turns").notNull().default(0),
  usd: real("usd").notNull().default(0),
  tokens: integer("tokens").notNull().default(0),
  computerSteps: integer("computer_steps").notNull().default(0),
  wallMin: real("wall_min").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id").notNull(),
    chainId: text("chain_id").notNull(),
    engine: text("engine").notNull(),
    model: text("model").notNull(),
    effort: text("effort"),
    routeDecisionId: text("route_decision_id"),
    sessionId: text("session_id"),
    status: text("status").notNull(),
    usage: text("usage", { mode: "json" }).notNull().$type<TurnUsage>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("turns_chain_id_idx").on(t.chainId), index("turns_bot_id_idx").on(t.botId)],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    botId: text("bot_id").notNull(),
    chainId: text("chain_id"),
    summary: text("summary").notNull(),
    detail: text("detail").notNull(),
    risk: real("risk"),
    status: text("status").notNull(),
    resolution: text("resolution"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("approvals_status_idx").on(t.status)],
);

export const rules = sqliteTable("rules", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  match: text("match", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  effect: text("effect").notNull(),
  source: text("source").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  publicKey: text("public_key").notNull(),
  via: text("via").notNull(),
  pairedAt: integer("paired_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
});

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  appId: text("app_id").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull(),
  toolMeta: text("tool_meta", { mode: "json" })
    .notNull()
    .$type<Record<string, { sideEffect: boolean }>>(),
  triggers: text("triggers", { mode: "json" }).notNull().$type<string[]>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const computerTasks = sqliteTable(
  "computer_tasks",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id").notNull(),
    chainId: text("chain_id").notNull(),
    goal: text("goal").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    steps: integer("steps").notNull().default(0),
    usd: real("usd").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("computer_tasks_bot_id_idx").on(t.botId)],
);

export const routines = sqliteTable(
  "routines",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id").notNull(),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    createdBy: text("created_by").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    liveApproved: integer("live_approved", { mode: "boolean" }).notNull().default(false),
    trigger: text("trigger", { mode: "json" }).notNull().$type<RoutineTrigger>(),
    limits: text("limits", { mode: "json" }).notNull().$type<RoutineLimits>(),
    pausedReason: text("paused_reason"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("routines_bot_id_idx").on(t.botId)],
);

export const routineRuns = sqliteTable(
  "routine_runs",
  {
    id: text("id").primaryKey(),
    routineId: text("routine_id").notNull(),
    chainId: text("chain_id").notNull(),
    cause: text("cause").notNull(),
    triggerEventIds: text("trigger_event_ids", { mode: "json" }).notNull().$type<string[]>(),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull(),
    status: text("status").notNull(),
    skipReason: text("skip_reason"),
    usage: text("usage", { mode: "json" }).notNull().$type<TurnUsage>(),
    resultSummary: text("result_summary"),
    plannedActions: text("planned_actions", { mode: "json" }).$type<string[]>(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("routine_runs_routine_id_idx").on(t.routineId)],
);

export const triggerEvents = sqliteTable(
  "trigger_events",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    routineId: text("routine_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    payloadRef: text("payload_ref").notNull(),
    matched: integer("matched", { mode: "boolean" }).notNull(),
    matchDecisionId: text("match_decision_id"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("trigger_events_routine_id_idx").on(t.routineId),
    index("trigger_events_payload_hash_idx").on(t.payloadHash),
  ],
);

export const engineSessions = sqliteTable(
  "engine_sessions",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id").notNull(),
    engine: text("engine").notNull(),
    sessionId: text("session_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("engine_sessions_bot_id_idx").on(t.botId)],
);

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    purpose: text("purpose").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    stateHash: text("state_hash").notNull(),
    answers: text("answers", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    thresholds: text("thresholds", { mode: "json" }).$type<Record<string, number>>(),
    band: text("band").notNull(),
    outcome: text("outcome").notNull(),
    feedback: text("feedback"),
    /** From Jev's `x-typesafe-request-id` response header (jev-spike §8); absent for llm/heuristic fallbacks. */
    requestId: text("request_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("decisions_purpose_idx").on(t.purpose)],
);

export const capCounters = sqliteTable(
  "cap_counters",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    windowStart: integer("window_start", { mode: "timestamp_ms" }).notNull(),
    windowSec: integer("window_sec").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [index("cap_counters_scope_key_idx").on(t.scope, t.key)],
);

export const settings = sqliteTable("settings", {
  id: text("id").primaryKey().default("singleton"),
  caps: text("caps", { mode: "json" }).notNull().$type<Record<string, number>>(),
  budgets: text("budgets", { mode: "json" }).notNull().$type<Record<string, number>>(),
  quietHours: text("quiet_hours", { mode: "json" }).$type<{
    enabled: boolean;
    start: string;
    end: string;
  }>(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const setupState = sqliteTable("setup_state", {
  id: text("id").primaryKey().default("singleton"),
  typesafe: text("typesafe", { mode: "json" }).$type<{ ok: boolean }>(),
  claude: text("claude", { mode: "json" }).$type<{ ok: boolean; mode?: string }>(),
  codex: text("codex", { mode: "json" }).$type<{ ok: boolean; mode?: string }>(),
  /** Unused since D-019 (hosted connector provider removed); kept to avoid a migration. */
  composio: text("composio", { mode: "json" }).$type<{ ok: boolean }>(),
  tailscale: text("tailscale", { mode: "json" }).$type<{ ok: boolean }>(),
  cloudflare: text("cloudflare", { mode: "json" }).$type<{ ok: boolean }>(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

/**
 * Persisted `OBEvent` log (plan §4.2): the event bus's source of truth. `seq` is
 * monotonic and drives WebSocket replay (`{subscribe, since}`) with no gaps.
 */
export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    ts: integer("ts", { mode: "timestamp_ms" }).notNull(),
    type: text("type").notNull(),
    botId: text("bot_id"),
    threadId: text("thread_id"),
    turnId: text("turn_id"),
    chainId: text("chain_id"),
    payload: text("payload", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  },
  (t) => [index("events_type_idx").on(t.type), index("events_bot_id_idx").on(t.botId)],
);

export const delegations = sqliteTable(
  "delegations",
  {
    id: text("id").primaryKey(),
    chainId: text("chain_id").notNull(),
    requesterBotId: text("requester_bot_id").notNull(),
    assigneeBotId: text("assignee_bot_id").notNull(),
    ownerThreadId: text("owner_thread_id").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    statusMessage: text("status_message"),
    result: text("result"),
    engine: text("engine"),
    roundTrips: integer("round_trips").notNull().default(1),
    wakePending: integer("wake_pending", { mode: "boolean" }).notNull().default(false),
    wakeKind: text("wake_kind"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    lastEventAt: integer("last_event_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("delegations_assignee_idx").on(t.assigneeBotId),
    index("delegations_requester_idx").on(t.requesterBotId),
    index("delegations_state_idx").on(t.state),
  ],
);
