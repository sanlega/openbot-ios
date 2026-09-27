import type { TurnHooks, TurnResult } from "@openbot/contracts";

export interface ClaudeParseState {
  sessionId?: string;
  text: string;
  usage: { inputTokens: number; outputTokens: number; usd?: number };
  isError: boolean;
  errorMessage?: string;
  authFailure: boolean;
  turnComplete: boolean;
}

export function createClaudeParseState(): ClaudeParseState {
  return {
    text: "",
    usage: { inputTokens: 0, outputTokens: 0 },
    isError: false,
    authFailure: false,
    turnComplete: false,
  };
}

export function handleClaudeLine(
  line: Record<string, unknown>,
  state: ClaudeParseState,
  hooks: Pick<TurnHooks, "emit">,
): void {
  const type = line.type;
  if (type === "system" && line.subtype === "init" && typeof line.session_id === "string") {
    state.sessionId = line.session_id;
    hooks.emit({ type: "session_started", sessionId: line.session_id });
    return;
  }

  if (type === "assistant") {
    const message = line.message as
      { content?: Array<{ type?: string; text?: string }> } | undefined;
    const chunks = message?.content ?? [];
    for (const chunk of chunks) {
      if (chunk.type === "text" && typeof chunk.text === "string" && chunk.text.length > 0) {
        state.text += chunk.text;
        hooks.emit({ type: "text_delta", text: chunk.text });
      }
    }
    if (line.error === "authentication_failed") {
      state.authFailure = true;
      state.isError = true;
      hooks.emit({
        type: "error",
        message: "authentication_failed",
        authFailure: true,
      });
    }
    return;
  }

  if (type === "stream_event") {
    const event = line.event as
      { type?: string; delta?: { type?: string; text?: string } } | undefined;
    if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
      const text = event.delta.text ?? "";
      if (text) {
        state.text += text;
        hooks.emit({ type: "text_delta", text });
      }
    }
    return;
  }

  if (type === "result") {
    state.turnComplete = true;
    state.isError = Boolean(line.is_error);
    if (typeof line.result === "string" && state.isError) {
      state.errorMessage = line.result;
    }
    const usage = line.usage as
      | { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
      | undefined;
    state.usage = {
      inputTokens: usage?.input_tokens ?? state.usage.inputTokens,
      outputTokens: usage?.output_tokens ?? state.usage.outputTokens,
      usd: typeof line.total_cost_usd === "number" ? line.total_cost_usd : undefined,
    };
    hooks.emit({
      type: "usage",
      inputTokens: state.usage.inputTokens,
      outputTokens: state.usage.outputTokens,
      usd: state.usage.usd,
    });
    if (state.isError && !state.errorMessage) {
      state.errorMessage = typeof line.result === "string" ? line.result : "turn failed";
    }
    if (state.authFailure || line.result === "Not logged in · Please run /login") {
      state.authFailure = true;
    }
  }
}

export function toTurnResult(state: ClaudeParseState): TurnResult {
  return {
    sessionId: state.sessionId ?? "",
    isError: state.isError,
    errorMessage: state.errorMessage,
    usage: state.usage,
  };
}
