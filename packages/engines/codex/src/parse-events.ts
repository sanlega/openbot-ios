import type { EngineEvent, TurnHooks, TurnResult } from "@openbot/contracts";
import type { CodexJsonRpcNotification } from "./generated/protocol.js";

export interface CodexParseState {
  threadId?: string;
  turnId?: string;
  sessionId?: string;
  text: string;
  usage: { inputTokens: number; outputTokens: number; usd?: number };
  isError: boolean;
  errorMessage?: string;
  authFailure: boolean;
  turnComplete: boolean;
}

export function createCodexParseState(): CodexParseState {
  return {
    text: "",
    usage: { inputTokens: 0, outputTokens: 0 },
    isError: false,
    authFailure: false,
    turnComplete: false,
  };
}

function asNotification(line: Record<string, unknown>): CodexJsonRpcNotification | null {
  if (line.method && line.jsonrpc === "2.0") {
    return line as unknown as CodexJsonRpcNotification;
  }
  if (line.method && !line.id) {
    return {
      jsonrpc: "2.0",
      method: String(line.method),
      params: line.params as Record<string, unknown>,
    };
  }
  return null;
}

export function handleCodexResponse(
  line: Record<string, unknown>,
  state: CodexParseState,
  hooks: Pick<TurnHooks, "emit">,
): void {
  if (line.result && line.id != null) {
    const result = line.result as Record<string, unknown>;
    const thread = result.thread as { id?: string; sessionId?: string } | undefined;
    if (thread?.id) {
      state.threadId = thread.id;
      state.sessionId = thread.sessionId ?? thread.id;
      hooks.emit({ type: "session_started", sessionId: state.sessionId });
    }
    const turn = result.turn as { id?: string; status?: string } | undefined;
    if (turn?.id) {
      state.turnId = turn.id;
    }
    return;
  }

  const notification = asNotification(line);
  if (!notification) return;
  handleCodexNotification(notification, state, hooks);
}

export function handleCodexNotification(
  notification: CodexJsonRpcNotification,
  state: CodexParseState,
  hooks: Pick<TurnHooks, "emit">,
): void {
  const method = notification.method;
  const params = notification.params ?? {};

  if (method === "agent/message/delta" || method === "turn/agentMessage/delta") {
    const delta = params.delta as { text?: string } | undefined;
    const text = delta?.text ?? "";
    if (text) {
      state.text += text;
      hooks.emit({ type: "text_delta", text });
    }
    return;
  }

  if (method === "turn/completed") {
    state.turnComplete = true;
    const turn = params.turn as { status?: string; error?: unknown } | undefined;
    if (turn?.status === "failed" || turn?.error) {
      state.isError = true;
      state.errorMessage = state.errorMessage ?? errorText(turn.error) ?? "turn failed";
    }
    return;
  }

  if (method === "error") {
    const error = params.error as
      | {
          message?: string;
          codexErrorInfo?: { responseStreamDisconnected?: { httpStatusCode?: number } };
        }
      | undefined;
    const status = error?.codexErrorInfo?.responseStreamDisconnected?.httpStatusCode;
    if (status === 401) {
      state.authFailure = true;
      state.isError = true;
      hooks.emit({ type: "error", message: "authentication_failed", authFailure: true });
    }
    // Codex gives up (e.g. "model not supported with a ChatGPT account"): the
    // turn is over, with Codex's own reason.
    if (params.willRetry === false) {
      state.turnComplete = true;
      state.isError = true;
      state.errorMessage =
        status === 401
          ? "authentication_failed"
          : (errorText(error) ?? "Codex stopped with an error");
    }
  }
}

/** Codex errors arrive as strings, objects with `message`, or JSON text of an API error. */
function errorText(error: unknown): string | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return unwrapApiError(error);
  if (typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return unwrapApiError((error as { message: string }).message);
  }
  return undefined;
}

function unwrapApiError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (typeof parsed.error?.message === "string") return parsed.error.message;
  } catch {
    // not JSON
  }
  return text;
}

export function toCodexTurnResult(state: CodexParseState): TurnResult {
  return {
    sessionId: state.sessionId ?? state.threadId ?? "",
    isError: state.isError,
    errorMessage: state.errorMessage,
    usage: state.usage,
  };
}

export function isAuthFailureNotification(notification: CodexJsonRpcNotification): boolean {
  if (notification.method !== "error") return false;
  const error = notification.params?.error as
    { codexErrorInfo?: { responseStreamDisconnected?: { httpStatusCode?: number } } } | undefined;
  return error?.codexErrorInfo?.responseStreamDisconnected?.httpStatusCode === 401;
}

export type { EngineEvent };
