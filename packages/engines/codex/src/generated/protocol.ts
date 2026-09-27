/** Generated from `packages/engines/fixtures/codex-schema/` (codex-cli 0.157.1). */
export const CODEX_SERVER_REQUEST_METHODS = [
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
] as const;

export type CodexServerRequestMethod = (typeof CODEX_SERVER_REQUEST_METHODS)[number];

export interface CodexJsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface CodexJsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface CodexJsonRpcNotification {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface ThreadStartResult {
  thread: { id: string; sessionId?: string };
}

export interface TurnStartResult {
  turn: { id: string; status?: string };
}

export interface McpServerStatusListResult {
  data: Array<{ name: string; runtimeStatus?: string }>;
}

export type CodexApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export const CODEX_MIN_VERSION = "0.157.1";

export const CODEX_PINNED_SERVER_REQUEST_METHODS = CODEX_SERVER_REQUEST_METHODS;
