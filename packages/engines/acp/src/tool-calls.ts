import type { ToolCall, ToolCallUpdate } from "@agentclientprotocol/sdk";

/**
 * A tool call as OpenBot sees it: the permission broker and Activity know Claude's tool names
 * (`Write`, `Bash`, `Read`...), so ACP tool kinds are mapped onto them; MCP tools become
 * `mcp__<server>__<tool>` like Claude's, so `allowTools: ["mcp__openbot"]` matches them.
 */
export interface TrackedToolCall {
  id: string;
  /** The agent's own name for the tool, from the first report (titles change later). */
  rawName: string;
  kind?: string;
  rawInput: Record<string, unknown>;
  locations: string[];
  started: boolean;
  finished: boolean;
}

const KIND_NAMES: Record<string, string> = {
  read: "Read",
  edit: "Write",
  delete: "Delete",
  move: "Move",
  search: "Grep",
  execute: "Bash",
  fetch: "WebFetch",
  think: "Think",
};

export function track(
  calls: Map<string, TrackedToolCall>,
  update: ToolCall | ToolCallUpdate,
): TrackedToolCall {
  let call = calls.get(update.toolCallId);
  if (!call) {
    call = {
      id: update.toolCallId,
      rawName: update.name ?? update.title ?? "tool",
      rawInput: {},
      locations: [],
      started: false,
      finished: false,
    };
    calls.set(update.toolCallId, call);
  }
  if (update.kind) call.kind = update.kind;
  if (update.name) call.rawName = update.name;
  if (isRecord(update.rawInput) && Object.keys(update.rawInput).length > 0) {
    call.rawInput = { ...call.rawInput, ...update.rawInput };
  }
  const paths = (update.locations ?? []).map((l) => l.path).filter(Boolean);
  if (paths.length > 0) call.locations = paths;
  return call;
}

/** Cursor reports every MCP call as one tool, with the server and tool inside its input. */
function cursorMcp(
  call: TrackedToolCall,
): { server: string; tool: string; args: unknown } | undefined {
  const { providerIdentifier, toolName, args } = call.rawInput;
  if (typeof providerIdentifier === "string" && typeof toolName === "string") {
    return { server: providerIdentifier, tool: toolName, args };
  }
  return undefined;
}

/** The name the broker and Activity see. */
export function toolNameOf(call: TrackedToolCall, mcpServers: string[]): string {
  const mcp = cursorMcp(call);
  if (mcp) return `mcp__${mcp.server}__${mcp.tool}`;
  for (const server of mcpServers) {
    for (const sep of ["_", "__", "/", ":"]) {
      const prefix = `${server}${sep}`;
      if (call.rawName.startsWith(prefix) && call.rawName.length > prefix.length) {
        return `mcp__${server}__${call.rawName.slice(prefix.length)}`;
      }
    }
  }
  if (call.rawName.startsWith("mcp__")) return call.rawName;
  const byKind = call.kind ? KIND_NAMES[call.kind] : undefined;
  return byKind ?? call.rawName;
}

/** The input in the shape the tool classifier reads (`file_path`, `command`...). */
export function toolInputOf(call: TrackedToolCall): Record<string, unknown> {
  const mcp = cursorMcp(call);
  if (mcp) {
    return typeof mcp.args === "object" && mcp.args !== null && !Array.isArray(mcp.args)
      ? { ...(mcp.args as Record<string, unknown>) }
      : {};
  }
  const input: Record<string, unknown> = { ...call.rawInput };
  const path =
    str(input.file_path) ??
    str(input.filePath) ??
    str(input.path) ??
    call.locations[0] ??
    undefined;
  if ((call.kind === "edit" || call.kind === "read" || call.kind === "delete") && path) {
    input.file_path = path;
  }
  if (call.kind === "edit" && call.locations.length > 1) input.paths = call.locations;
  if (call.kind === "execute" && input.command === undefined && str(input.cmd)) {
    input.command = input.cmd;
  }
  return input;
}

/** What a finished tool returned, as text when the agent sent text. */
export function toolOutputOf(update: ToolCallUpdate): unknown {
  const raw = update.rawOutput;
  if (isRecord(raw) && raw.output !== undefined) return raw.output;
  const texts = (update.content ?? [])
    .map((c) => (c.type === "content" && c.content.type === "text" ? c.content.text : undefined))
    .filter((t): t is string => typeof t === "string");
  if (texts.length > 0) return texts.join("\n");
  return raw ?? null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
