import type { OBEvent } from "@openbot/contracts";

/** Transport mode per plan §4.8 — WS11 adds E2E framing for remote modes. */
export type TransportMode = "local" | "lan" | "tailscale" | "cloudflare";

export interface TransportOptions {
  baseUrl: string;
  mode?: TransportMode;
  /** Device token for remote transports (WS11). */
  deviceToken?: string;
}

/**
 * Client API WebSocket commands (plan §4.7), as the harness accepts them:
 * `{ type: "command", command, payload }`.
 */
export type WsCommand =
  | {
      command: "message.send";
      payload: { botId: string; text: string; threadId?: string; chainId?: string };
    }
  | { command: "approval.resolve"; payload: { id: string; resolution: "allow" | "deny" } }
  | { command: "turn.stop"; payload: { turnId: string } }
  | { command: "routine.run"; payload: { routineId: string; dryRun?: boolean } };

/** `{ type: "subscribe", since }`: replay after `since` (exclusive), then live events. */
export interface WsSubscribeFrame {
  type: "subscribe";
  since: number;
}

export type WsOutbound = WsSubscribeFrame | ({ type: "command" } & WsCommand);

export interface WsInbound {
  type: "event" | "command.result" | "replay.done" | "error";
  event?: OBEvent;
  command?: string;
  ok?: boolean;
  reason?: string;
  error?: string;
  message?: string;
}

export interface Transport {
  readonly mode: TransportMode;
  readonly baseUrl: string;
  get<T>(path: string, init?: RequestInit): Promise<T>;
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
  delete<T>(path: string, init?: RequestInit): Promise<T>;
  connectWebSocket(
    onMessage: (msg: WsInbound) => void,
    onClose?: () => void,
    onOpen?: () => void,
  ): { subscribe(since: number): void; send(command: WsCommand): void; close(): void };
  close(): Promise<void>;
}
