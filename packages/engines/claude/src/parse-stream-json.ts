import type { TurnHooks, TurnResult } from "@openbot/contracts";

export interface ClaudeParseState {
  sessionId?: string;
  text: string;
  usage: { inputTokens: number; outputTokens: number; usd?: number };
  isError: boolean;
  errorMessage?: string;
  authFailure: boolean;
  turnComplete: boolean;
  /** Partial deltas arrived for the message in progress; its full `assistant` line repeats them. */
  streamedText: boolean;
}

export function createClaudeParseState(): ClaudeParseState {
  return {
    text: "",
    usage: { inputTokens: 0, outputTokens: 0 },
    isError: false,
    authFailure: false,
    turnComplete: false,
    streamedText: false,
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
      | {
          content?: Array<{
            type?: string;
            text?: string;
            id?: string;
            name?: string;
            input?: unknown;
          }>;
        }
      | undefined;
    const chunks = message?.content ?? [];
    for (const chunk of chunks) {
      if (chunk.type === "tool_use" && chunk.id && chunk.name) {
        hooks.emit({
          type: "tool_started",
          toolName: chunk.name,
          input: chunk.input ?? {},
          toolUseId: chunk.id,
        });
      }
    }
    // With --include-partial-messages the text already arrived as stream deltas.
    if (!state.streamedText) {
      for (const chunk of chunks) {
        if (chunk.type === "text" && typeof chunk.text === "string" && chunk.text.length > 0) {
          state.text += chunk.text;
          hooks.emit({ type: "text_delta", text: chunk.text });
        }
      }
    }
    state.streamedText = false;
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

  if (type === "user") {
    // Tool results come back to the model as a user message.
    const message = line.message as
      | {
          content?: Array<{
            type?: string;
            tool_use_id?: string;
            content?: unknown;
            is_error?: boolean;
          }>;
        }
      | undefined;
    const chunks = Array.isArray(message?.content) ? message.content : [];
    for (const chunk of chunks) {
      if (chunk.type === "tool_result" && chunk.tool_use_id) {
        hooks.emit({
          type: "tool_completed",
          toolUseId: chunk.tool_use_id,
          output: chunk.content ?? null,
          isError: Boolean(chunk.is_error),
        });
      }
    }
    return;
  }

  if (type === "stream_event") {
    const event = line.event as
      { type?: string; delta?: { type?: string; text?: string } } | undefined;
    if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
      const text = event.delta.text ?? "";
      if (text) {
        state.streamedText = true;
        state.text += text;
        hooks.emit({ type: "text_delta", text });
      }
    }
    return;
  }

  if (type === "openbot_process_exit") {
    if (state.turnComplete) return;
    state.turnComplete = true;
    state.isError = true;
    const stderr = typeof line.stderr === "string" ? line.stderr : "";
    const lastLine = stderr.split("\n").filter(Boolean).pop();
    state.errorMessage = `Claude Code stopped unexpectedly${
      typeof line.code === "number" ? ` (exit code ${line.code})` : ""
    }${lastLine ? `: ${lastLine}` : "."}`;
    if (/not logged in|\/login/i.test(stderr)) state.authFailure = true;
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
