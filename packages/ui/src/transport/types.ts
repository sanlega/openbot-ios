import type { OBEvent } from "@openbot/contracts";

/** Transport mode per plan §4.8 — WS11 adds E2E framing for remote modes. */
export type TransportMode = "local" | "lan" | "tailscale" | "cloudflare";

export interface TransportOptions {
  baseUrl: string;
  mode?: TransportMode;
  /** Device token for remote transports (WS11). */
  deviceToken?: string;
}

export type WsCommand =
  | { type: "message.send"; threadId: string; text: string; attachments?: string[] }
  | { type: "approval.resolve"; approvalId: string; resolution: "allow" | "deny" }
  | { type: "turn.stop"; threadId: string }
  | { type: "routine.run"; routineId: string; dryRun?: boolean };

export interface WsSubscribeFrame {
  subscribe: true;
  since: number;
}

export type WsOutbound = WsSubscribeFrame | WsCommand;

export interface WsInbound {
  type: "event" | "replay.done" | "error";
  event?: OBEvent;
  message?: string;
}

export interface Transport {
  readonly mode: TransportMode;
  readonly baseUrl: string;
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  connectWebSocket(
    onMessage: (msg: WsInbound) => void,
    onClose?: () => void,
  ): { subscribe(since: number): void; send(command: WsCommand): void; close(): void };
  close(): Promise<void>;
}
