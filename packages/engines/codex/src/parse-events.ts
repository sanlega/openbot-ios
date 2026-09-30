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
  /** Thread token totals before this turn's first model call, to report this turn's own usage. */
  usageBaseline?: { input: number; output: number };
  /** What has already been reported as `usage` events (the runtime adds each event up). */
  usageReported?: { input: number; output: number };
  /** Agent-message items whose text already arrived as deltas (so `item/completed` doesn't repeat it). */
  streamedItems?: Set<string>;
}

export function createCodexParseState(): CodexParseState {
  return {
    text: "",
    usage: { inputTokens: 0, outputTokens: 0 },
    isError: false,
    authFailure: false,
    turnComplete: false,
    streamedItems: new Set(),
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

  // One app-server serves every Bot's thread: only this turn's thread counts, and within it only this
  // turn (an interrupted turn's late `turn/completed` must not end the next one).
  if (!isOwnThread(params, state) || !isOwnTurn(params, state)) return;

  if (method === "thread/tokenUsage/updated") {
    recordUsage(params.tokenUsage as CodexTokenUsage | undefined, state, hooks);
    return;
  }

  // Codex 0.155+ streams `item/agentMessage/delta` with a plain string; older CLIs sent an
  // object with `text` under other method names.
  if (
    method === "item/agentMessage/delta" ||
    method === "agent/message/delta" ||
    method === "turn/agentMessage/delta"
  ) {
    const delta = params.delta as string | { text?: string } | undefined;
    const text = typeof delta === "string" ? delta : (delta?.text ?? "");
    const itemId = typeof params.itemId === "string" ? params.itemId : undefined;
    if (itemId) (state.streamedItems ??= new Set()).add(itemId);
    if (text) {
      state.text += text;
      hooks.emit({ type: "text_delta", text });
    }
    return;
  }

  if (method === "item/started" || method === "item/completed") {
    handleItem(method === "item/completed", params.item as CodexItem | undefined, state, hooks);
    return;
  }

  if (method === "turn/completed") {
    state.turnComplete = true;
    const turn = params.turn as
      { status?: string; error?: unknown; items?: CodexItem[] } | undefined;
    // A turn whose text never streamed still carries its final messages.
    if (!state.text) {
      const finals = (turn?.items ?? []).filter(
        (item) => item.type === "agentMessage" && typeof item.text === "string" && item.text,
      );
      const text = finals.map((item) => item.text as string).join("\n");
      if (text) {
        state.text = text;
        hooks.emit({ type: "text_delta", text });
      }
    }
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

interface CodexItem {
  type?: string;
  id?: string;
  text?: string;
  command?: string;
  status?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  server?: string;
  tool?: string;
  namespace?: string | null;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  changes?: unknown;
  query?: string;
}

interface CodexTokenUsage {
  total?: { inputTokens?: number; outputTokens?: number };
  last?: { inputTokens?: number; outputTokens?: number };
}

/** This turn's tokens: the thread's running total minus what it had before the turn's first call. */
function recordUsage(
  usage: CodexTokenUsage | undefined,
  state: CodexParseState,
  hooks: Pick<TurnHooks, "emit">,
): void {
  const input = usage?.total?.inputTokens;
  const output = usage?.total?.outputTokens;
  if (typeof input !== "number" || typeof output !== "number") return;
  state.usageBaseline ??= {
    input: Math.max(0, input - (usage?.last?.inputTokens ?? 0)),
    output: Math.max(0, output - (usage?.last?.outputTokens ?? 0)),
  };
  state.usage = {
    ...state.usage,
    inputTokens: input - state.usageBaseline.input,
    outputTokens: output - state.usageBaseline.output,
  };
  // The runtime adds up every `usage` event, so report only what is new since the last one.
  const reported = (state.usageReported ??= { input: 0, output: 0 });
  const deltaInput = state.usage.inputTokens - reported.input;
  const deltaOutput = state.usage.outputTokens - reported.output;
  if (deltaInput <= 0 && deltaOutput <= 0) return;
  reported.input = state.usage.inputTokens;
  reported.output = state.usage.outputTokens;
  hooks.emit({ type: "usage", inputTokens: deltaInput, outputTokens: deltaOutput });
}

function isOwnTurn(params: Record<string, unknown>, state: CodexParseState): boolean {
  const turnId =
    typeof params.turnId === "string"
      ? params.turnId
      : (params.turn as { id?: string } | undefined)?.id;
  return typeof turnId !== "string" || !state.turnId || turnId === state.turnId;
}

function isOwnThread(params: Record<string, unknown>, state: CodexParseState): boolean {
  const threadId = params.threadId;
  return typeof threadId !== "string" || !state.threadId || threadId === state.threadId;
}

/** The tool-like items of a Codex turn, as the tool events every other engine emits. */
function toolOf(item: CodexItem): { name: string; input: unknown } | undefined {
  switch (item.type) {
    case "commandExecution":
      return { name: "shell", input: { command: item.command } };
    case "mcpToolCall":
      return { name: `mcp__${item.server}__${item.tool}`, input: item.arguments ?? {} };
    case "dynamicToolCall":
      return {
        name: item.namespace ? `${item.namespace}__${item.tool}` : String(item.tool),
        input: item.arguments ?? {},
      };
    case "fileChange":
      return { name: "apply_patch", input: { changes: item.changes } };
    case "webSearch":
      return { name: "web_search", input: { query: item.query } };
    default:
      return undefined;
  }
}

function handleItem(
  completed: boolean,
  item: CodexItem | undefined,
  state: CodexParseState,
  hooks: Pick<TurnHooks, "emit">,
): void {
  if (!item?.type || !item.id) return;
  if (item.type === "agentMessage") {
    // Text that never streamed as deltas (or arrived only in the completed item).
    if (completed && item.text && !state.streamedItems?.has(item.id)) {
      state.text += item.text;
      hooks.emit({ type: "text_delta", text: item.text });
    }
    return;
  }
  const tool = toolOf(item);
  if (!tool) return;
  if (!completed) {
    hooks.emit({
      type: "tool_started",
      toolName: tool.name,
      input: tool.input,
      toolUseId: item.id,
    });
    return;
  }
  const failed =
    item.status === "failed" ||
    item.status === "declined" ||
    (typeof item.exitCode === "number" && item.exitCode !== 0);
  hooks.emit({
    type: "tool_completed",
    toolUseId: item.id,
    output: item.aggregatedOutput ?? item.result ?? item.error ?? null,
    isError: failed,
  });
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
