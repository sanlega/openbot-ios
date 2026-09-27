import type {
  Approval,
  Bot,
  Decision,
  Message,
  Routine,
  Settings,
  SetupState,
  Thread,
} from "@openbot/contracts";

/** Client API response shapes (plan §4.7) — WS1 will host; UI types them here until shared schemas land. */

export interface HealthResponse {
  status: "ok";
}

export interface BotsResponse {
  bots: Bot[];
}

export interface ThreadsResponse {
  threads: ThreadView[];
}

/**
 * Thread view model — extends contract `Thread` with participant metadata so
 * group chats (2–6 participants) can be added without a UI rewrite.
 */
export interface ThreadView extends Thread {
  /** All participants; for DM this is `[botId, 'user']`. */
  participantIds: string[];
  /** Display title — bot name for DM, custom for future groups. */
  title: string;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  unreadCount?: number;
}

export interface MessagesResponse {
  messages: Message[];
}

export interface ApprovalsResponse {
  approvals: Approval[];
}

export interface ActivityResponse {
  events: ActivityEntry[];
}

export interface ActivityEntry {
  id: string;
  ts: string;
  botId?: string;
  threadId?: string;
  type: string;
  summary: string;
  delivery?: "delivered" | "held" | "merged";
  messageId?: string;
}

export interface AuditEntry {
  id: string;
  ts: string;
  actor: string;
  action: string;
  detail: string;
}

export interface AuditResponse {
  entries: AuditEntry[];
}

export interface SetupResponse {
  setup: SetupState;
}

export interface SetupValidateRequest {
  kind:
    | "typesafe"
    | "anthropic"
    | "openai"
    | "claude_login"
    | "codex_login"
    | "tailscale"
    | "cloudflare";
  value?: string;
}

export interface SetupValidateResponse {
  ok: boolean;
  reason?: string;
}

export interface SettingsResponse {
  settings: Settings;
}

export interface RoutePreview {
  engine: string;
  model: string;
  effort?: "low" | "medium" | "high";
  confidence: number;
  decisionId?: string;
}

export interface BotWhyResponse {
  justification: Bot["justification"];
  spawnDecision?: Decision;
}

export interface RoutinesResponse {
  routines: Routine[];
}

export interface UsageSummary {
  totalUsd: number;
  totalTokens: number;
  byBot: Record<string, { usd: number; tokens: number }>;
}

export interface DecisionsResponse {
  decisions: Decision[];
  cursor?: string;
}

export interface RemoteStatusResponse {
  enabled: boolean;
  via?: "lan" | "tailscale" | "cloudflare";
  urls?: string[];
}

export interface DevicesResponse {
  devices: Array<{
    id: string;
    name: string;
    role: "owner" | "approver";
    via: "lan" | "tailscale" | "cloudflare";
    pairedAt: string;
    lastSeenAt?: string;
  }>;
}

export interface ComputerStatusResponse {
  provider: "docker" | "local" | "fake";
  running: boolean;
  screensActive: number;
  sharedWorkspaceNotice: string;
}

export interface LiveViewResponse {
  url: string;
  token: string;
  expiresAt: string;
}

export interface ComputerTaskView {
  id: string;
  botId: string;
  goal: string;
  status: string;
  steps: number;
  /** Not reported by the harness yet. */
  timeline?: Array<{ ts: string; op: string; detail: string }>;
}

export interface ComputerTasksResponse {
  tasks: ComputerTaskView[];
}

export interface RoutineRunView {
  id: string;
  routineId: string;
  dryRun: boolean;
  status: string;
  startedAt?: string;
  endedAt?: string;
  usage: { usd: number; inputTokens: number; outputTokens: number };
  resultSummary?: string;
  plannedActions?: string[];
  skipReason?: string;
}

export interface RoutineRunsResponse {
  runs: RoutineRunView[];
}

export interface EnginesResponse {
  engines: Array<{
    id: string;
    installed: boolean;
    version?: string;
    login: { ok: boolean; account?: string };
  }>;
}

export interface PairQrResponse {
  qrUrl: string;
  pairSecret: string;
  expiresAt: string;
  urls: string[];
}

export interface DigestContent {
  id: string;
  postedAt: string;
  sections: Array<{ title: string; items: string[] }>;
}

export interface DigestResponse {
  digest: DigestContent | null;
}

export interface SettingsPatch {
  caps?: Record<string, number>;
  budgets?: Record<string, number>;
  quietHours?: { enabled: boolean; start: string; end: string };
}

export type AppScreen =
  "bots" | "activity" | "audit" | "routines" | "connectors" | "settings" | "devices" | "computer";

export type ThreadPanel = "chat" | "computer" | "profile";
