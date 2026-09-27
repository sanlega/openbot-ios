import type {
  Approval,
  Bot,
  Message,
  OBEvent,
  Routine,
  Settings,
  SetupState,
  Thread,
} from "@openbot/contracts";
import type { ActivityEntry, AuditEntry, RoutePreview, ThreadView } from "../api/types.js";

const NOW = "2026-09-27T12:00:00.000Z";

export const SEED_BOTS: Bot[] = [
  {
    id: "bot_cos_01",
    slug: "chief-of-staff",
    name: "Chief of Staff",
    label: "CoS",
    description: "Orchestrates the roster and delegates selectively.",
    avatar: "🎩",
    pinned: true,
    hidden: false,
    isChiefOfStaff: true,
    createdBy: "user",
    lastActiveAt: NOW,
    routing: { mode: "auto" },
    permissionPreset: "full",
    computer: "docker",
    connectors: [],
    limits: { dailyUsd: 5, dailyTokens: 1_000_000 },
  },
  {
    id: "bot_research_01",
    slug: "research",
    name: "Research",
    description: "Deep dives, summaries, and citations.",
    avatar: "🔬",
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "bot_cos_01",
    lastActiveAt: "2026-09-27T11:45:00.000Z",
    routing: { mode: "pinned", engine: "claude", model: "claude-sonnet-4", effort: "medium" },
    permissionPreset: "workspace_write",
    computer: "docker",
    connectors: [],
    limits: { dailyUsd: 3, dailyTokens: 500_000 },
    justification: {
      responsibility: "Long-form research with citations",
      whyNotExisting: "CoS lacks dedicated research tooling",
      lifetime: "recurring",
      boundary: ["web research", "summaries"],
      userRequested: false,
      spawnDecisionId: "dec_spawn_01",
    },
  },
  {
    id: "bot_code_01",
    slug: "code",
    name: "Code",
    description: "Implements and reviews code in the shared workspace.",
    avatar: "⚡",
    pinned: true,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    lastActiveAt: "2026-09-27T10:30:00.000Z",
    routing: { mode: "auto" },
    permissionPreset: "workspace_write",
    computer: "docker+local",
    connectors: [],
    limits: { dailyUsd: 5, dailyTokens: 1_000_000 },
  },
];

export const SEED_THREADS: Thread[] = [
  { id: "thr_cos", botId: "bot_cos_01", kind: "dm", createdAt: "2026-09-20T08:00:00.000Z" },
  {
    id: "thr_research",
    botId: "bot_research_01",
    kind: "dm",
    createdAt: "2026-09-25T14:00:00.000Z",
  },
  { id: "thr_code", botId: "bot_code_01", kind: "dm", createdAt: "2026-09-22T09:00:00.000Z" },
];

export function threadView(thread: Thread, bots: Bot[]): ThreadView {
  const bot = bots.find((b) => b.id === thread.botId);
  return {
    ...thread,
    participantIds: [thread.botId, "user"],
    title: bot?.name ?? "Unknown",
    lastMessagePreview: undefined,
    unreadCount: 0,
  };
}

export const SEED_MESSAGES: Message[] = [
  {
    id: "msg_cos_1",
    threadId: "thr_cos",
    author: { type: "user", id: "user" },
    text: "What's on the agenda today?",
    attachments: [],
    chainId: "chn_01",
    hop: 0,
    createdAt: "2026-09-27T11:00:00.000Z",
    proactive: false,
    delivery: "delivered",
    pushed: false,
  },
  {
    id: "msg_cos_2",
    threadId: "thr_cos",
    author: { type: "bot", id: "bot_cos_01" },
    text: "Three items: the research brief is ready, Code is waiting on an approval, and I held two progress pings from Research.",
    attachments: [],
    chainId: "chn_01",
    hop: 1,
    createdAt: "2026-09-27T11:00:05.000Z",
    proactive: false,
    delivery: "delivered",
    pushed: false,
  },
  {
    id: "msg_cos_digest",
    threadId: "thr_cos",
    author: { type: "bot", id: "bot_cos_01" },
    text: "__digest__",
    attachments: [],
    chainId: "chn_digest",
    hop: 0,
    createdAt: "2026-09-26T18:00:00.000Z",
    proactive: true,
    kind: "result",
    delivery: "delivered",
    pushed: false,
  },
  {
    id: "msg_research_1",
    threadId: "thr_research",
    author: { type: "bot", id: "bot_research_01" },
    text: "Competitor landscape summary is ready for review.",
    attachments: [],
    chainId: "chn_02",
    hop: 0,
    createdAt: "2026-09-27T11:30:00.000Z",
    proactive: true,
    kind: "result",
    options: ["Looks good", "Expand APAC"],
    delivery: "delivered",
    pushed: true,
  },
  {
    id: "msg_research_held",
    threadId: "thr_research",
    author: { type: "bot", id: "bot_research_01" },
    text: "Still gathering sources… (progress update)",
    attachments: [],
    chainId: "chn_02",
    hop: 0,
    createdAt: "2026-09-27T11:20:00.000Z",
    proactive: true,
    delivery: "held",
    pushed: false,
  },
  {
    id: "msg_code_1",
    threadId: "thr_code",
    author: { type: "bot", id: "bot_code_01" },
    text: "I'd like to write `packages/ui/src/state/reducer.ts`.",
    attachments: [],
    chainId: "chn_03",
    hop: 0,
    createdAt: "2026-09-27T10:35:00.000Z",
    proactive: false,
    delivery: "delivered",
    pushed: false,
  },
];

export const SEED_APPROVALS: Approval[] = [
  {
    id: "apr_write_01",
    kind: "tool",
    botId: "bot_code_01",
    chainId: "chn_03",
    summary: "Write file packages/ui/src/state/reducer.ts",
    detail: "Create a new reducer module for OBEvent state.",
    risk: 0.15,
    status: "pending",
    resolution: undefined,
    expiresAt: "2026-09-27T13:00:00.000Z",
    createdAt: "2026-09-27T10:35:10.000Z",
  },
];

export const SEED_ROUTES: Record<string, RoutePreview> = {
  bot_cos_01: {
    engine: "claude",
    model: "claude-opus-4",
    effort: "high",
    confidence: 0.92,
    decisionId: "dec_route_01",
  },
  bot_research_01: {
    engine: "claude",
    model: "claude-sonnet-4",
    effort: "medium",
    confidence: 0.88,
    decisionId: "dec_route_02",
  },
  bot_code_01: {
    engine: "codex",
    model: "gpt-5-codex",
    effort: "medium",
    confidence: 0.91,
    decisionId: "dec_route_03",
  },
};

export const SEED_SETUP: SetupState = {
  id: "singleton",
  typesafe: { ok: true },
  claude: { ok: true, mode: "login" },
  codex: { ok: true, mode: "login" },
  completedAt: "2026-09-26T18:00:00.000Z",
};

export const SEED_SETTINGS: Settings = {
  id: "singleton",
  caps: { S1: 6, S2: 2, S4: 3, S5: 6 },
  budgets: { gates: 250, interactive: 200, computer: 450, background: 100 },
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
  updatedAt: NOW,
};

export const SEED_ROUTINES: Routine[] = [
  {
    id: "rtn_digest",
    botId: "bot_cos_01",
    name: "Daily digest",
    prompt: "Summarize held messages, routine results, and archive candidates.",
    createdBy: "user",
    enabled: true,
    liveApproved: true,
    trigger: {
      type: "schedule",
      cron: "0 18 * * *",
      timezone: "America/Los_Angeles",
      catchUp: "none",
    },
    limits: {
      perRun: { usd: 0.5, tokens: 200_000, turns: 10, computerSteps: 50, wallMin: 15 },
      dailyUsd: 2,
      maxRunsPerDay: 1,
      cooldownSec: 3600,
    },
    consecutiveFailures: 0,
    createdAt: "2026-09-20T08:00:00.000Z",
  },
  {
    id: "rtn_summary",
    botId: "bot_research_01",
    name: "Morning competitor scan",
    prompt: "Scan competitor news and summarize changes.",
    createdBy: "user",
    enabled: true,
    liveApproved: false,
    trigger: {
      type: "schedule",
      cron: "0 8 * * *",
      timezone: "America/Los_Angeles",
      catchUp: "none",
    },
    limits: {
      perRun: { usd: 0.5, tokens: 200_000, turns: 10, computerSteps: 50, wallMin: 15 },
      dailyUsd: 2,
      maxRunsPerDay: 1,
      cooldownSec: 3600,
    },
    consecutiveFailures: 0,
    createdAt: "2026-09-24T10:00:00.000Z",
  },
];

export const SEED_ROUTINE_RUNS = [
  {
    id: "rrun_dry_01",
    routineId: "rtn_summary",
    dryRun: true,
    status: "done",
    startedAt: "2026-09-27T08:00:01.000Z",
    endedAt: "2026-09-27T08:00:45.000Z",
    usage: { usd: 0.04, inputTokens: 9_000, outputTokens: 3_000 },
    resultSummary: "Dry run completed — side effects planned.",
    plannedActions: [
      "Would post summary to Research thread",
      "Would send email via connector (side effect)",
    ],
  },
  {
    id: "rrun_live_01",
    routineId: "rtn_digest",
    dryRun: false,
    status: "done",
    startedAt: "2026-09-26T18:00:00.000Z",
    endedAt: "2026-09-26T18:01:20.000Z",
    usage: { usd: 0.08, inputTokens: 18_000, outputTokens: 6_000 },
    resultSummary: "Digest posted to CoS thread",
  },
];

export const SEED_DIGEST = {
  id: "digest_2026_09_26",
  postedAt: "2026-09-26T18:00:00.000Z",
  sections: [
    {
      title: "Completed silently",
      items: ["Research finished competitor landscape summary"],
    },
    {
      title: "Held messages",
      items: ["Research: progress update (2×)"],
    },
    {
      title: "Archive candidates",
      items: ["None this week"],
    },
  ],
};

export const SEED_DEVICES = [
  {
    id: "dev_phone_01",
    name: "Pixel 9",
    role: "owner" as const,
    via: "tailscale" as const,
    pairedAt: "2026-09-20T12:00:00.000Z",
    lastSeenAt: "2026-09-27T11:55:00.000Z",
  },
  {
    id: "dev_tablet_01",
    name: "iPad approver",
    role: "approver" as const,
    via: "lan" as const,
    pairedAt: "2026-09-22T09:00:00.000Z",
    lastSeenAt: "2026-09-26T20:00:00.000Z",
  },
];

export const SEED_REMOTE = {
  enabled: true,
  via: "tailscale" as const,
  urls: ["https://openbot.tailnet.ts.net/app", "http://100.64.0.5:3847"],
};

export const SEED_ENGINES = [
  {
    id: "claude",
    installed: true,
    version: "2.1.283",
    login: { ok: true, account: "user@example.com" },
  },
  {
    id: "codex",
    installed: true,
    version: "0.157.1",
    login: { ok: true, account: "user@example.com" },
  },
];

export const SEED_COMPUTER_TASKS = [
  {
    id: "ctask_01",
    botId: "bot_code_01",
    goal: "Open GitHub PR list",
    status: "running",
    steps: 3,
    timeline: [
      { ts: "2026-09-27T10:40:00.000Z", op: "observe", detail: "Chromium on github.com" },
      { ts: "2026-09-27T10:40:02.000Z", op: "click", detail: "Pull requests tab (#12)" },
      { ts: "2026-09-27T10:40:05.000Z", op: "scroll", detail: "Page down" },
    ],
  },
];

export const SEED_ACTIVITY: ActivityEntry[] = [
  {
    id: "act_1",
    ts: "2026-09-27T11:30:00.000Z",
    botId: "bot_research_01",
    threadId: "thr_research",
    type: "message.delivered",
    summary: "Competitor landscape summary delivered",
    delivery: "delivered",
    messageId: "msg_research_1",
  },
  {
    id: "act_2",
    ts: "2026-09-27T11:20:00.000Z",
    botId: "bot_research_01",
    threadId: "thr_research",
    type: "message.held",
    summary: "Progress update held (chatter)",
    delivery: "held",
    messageId: "msg_research_held",
  },
  {
    id: "act_3",
    ts: "2026-09-27T10:35:10.000Z",
    botId: "bot_code_01",
    threadId: "thr_code",
    type: "approval.requested",
    summary: "File write approval pending",
  },
];

export const SEED_AUDIT: AuditEntry[] = [
  {
    id: "aud_1",
    ts: "2026-09-27T10:35:10.000Z",
    actor: "bot_code_01",
    action: "approval.requested",
    detail: "tool: write packages/ui/src/state/reducer.ts",
  },
  {
    id: "aud_2",
    ts: "2026-09-26T18:00:00.000Z",
    actor: "user",
    action: "setup.completed",
    detail: "First-run wizard finished",
  },
  {
    id: "aud_3",
    ts: "2026-09-25T14:00:00.000Z",
    actor: "bot_cos_01",
    action: "bot.created",
    detail: "Spawned Research bot (dec_spawn_01)",
  },
];

/** Initial persisted events for WebSocket replay (monotonic seq). */
export function buildSeedEvents(): OBEvent[] {
  return [
    {
      id: "evt_1",
      seq: 1,
      ts: "2026-09-27T11:00:05.000Z",
      type: "message.created",
      botId: "bot_cos_01",
      threadId: "thr_cos",
      payload: { messageId: "msg_cos_2", text: SEED_MESSAGES[1]!.text },
    },
    {
      id: "evt_2",
      seq: 2,
      ts: "2026-09-27T10:35:10.000Z",
      type: "approval.requested",
      botId: "bot_code_01",
      threadId: "thr_code",
      chainId: "chn_03",
      payload: { approvalId: "apr_write_01", kind: "tool", summary: SEED_APPROVALS[0]!.summary },
    },
    {
      id: "evt_3",
      seq: 3,
      ts: "2026-09-27T10:30:00.000Z",
      type: "route.decided",
      botId: "bot_code_01",
      payload: {
        engine: "codex",
        model: "gpt-5-codex",
        confidence: 0.91,
        decisionId: "dec_route_03",
      },
    },
    {
      id: "evt_4",
      seq: 4,
      ts: "2026-09-27T11:20:00.000Z",
      type: "message.held",
      botId: "bot_research_01",
      threadId: "thr_research",
      payload: { messageId: "msg_research_held", reason: "progress chatter" },
    },
  ];
}
