import type { Approval, Message } from "@openbot/contracts";
import type {
  ActivityEntry,
  AuditEntry,
  ComputerStatusResponse,
  RemoteStatusResponse,
} from "./types.js";

/**
 * Maps the harness's Client API responses (packages/core http routes) to the
 * UI's view models, where the two shapes differ.
 */

/** `GET /api/activity` returns messages; the activity log lists them as entries. */
export function activityFromMessages(messages: Message[]): ActivityEntry[] {
  return messages.map((m) => ({
    id: m.id,
    ts: m.createdAt,
    botId: m.author.type === "bot" ? m.author.id : undefined,
    threadId: m.threadId,
    type: m.proactive ? "message.proactive" : "message",
    summary: m.text,
    delivery: m.delivery,
    messageId: m.id,
  }));
}

export const SHARED_WORKSPACE_NOTICE =
  "All bots share one computer and workspace; bots are not a security boundary.";

/** `GET /api/computer/status`: `{ ready, detail?, provider? }`. */
export function computerStatusView(status: {
  ready: boolean;
  detail?: string;
  provider?: string;
}): ComputerStatusResponse {
  return {
    provider: (status.provider as ComputerStatusResponse["provider"]) ?? "fake",
    running: status.ready,
    screensActive: 0,
    sharedWorkspaceNotice: SHARED_WORKSPACE_NOTICE,
  };
}

export interface HarnessRemoteStatus {
  tailscale?: { serveEnabled?: boolean; serveUrls?: string[] };
  cloudflare?: { running?: boolean; hostname?: string };
}

/** `GET /api/remote/status`: per-provider detail → one "enabled via X" summary. */
export function remoteStatusView(status: HarnessRemoteStatus): RemoteStatusResponse {
  if (status.tailscale?.serveEnabled) {
    return { enabled: true, via: "tailscale", urls: status.tailscale.serveUrls ?? [] };
  }
  if (status.cloudflare?.running) {
    const host = status.cloudflare.hostname;
    return { enabled: true, via: "cloudflare", urls: host ? [`https://${host}`] : [] };
  }
  return { enabled: false };
}

/** `GET /api/audit` returns approvals (and turns); the audit log shows who asked and the outcome. */
export function auditFromApprovals(approvals: Approval[]): AuditEntry[] {
  return [...approvals]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => ({
      id: a.id,
      ts: a.createdAt,
      actor: a.botId,
      action: `${a.kind} ${a.status}${a.resolution ? `: ${a.resolution}` : ""}`,
      detail: a.summary,
    }));
}
