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
    | "composio"
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
