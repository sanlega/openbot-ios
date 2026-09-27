import { monotonicFactory } from "ulid";
import type {
  EngineDriver,
  EngineStatus,
  ModelInfo,
  TurnHandle,
  TurnHooks,
  TurnInput,
  TurnResult,
} from "@openbot/contracts";

const ulid = monotonicFactory();

export type FakeEngineMode = "loop" | "chatty";

export interface FakeEngineOptions {
  /** `"loop"` (default): always replies once, deterministically. `"chatty"`: also fires several `message_user` tool calls per turn before replying. */
  mode?: FakeEngineMode;
  /** Canned reply texts, cycled through in order across turns. */
  replies?: string[];
  /** Number of `message_user` tool calls emitted per turn in `"chatty"` mode. */
  chattyMessageCount?: number;
  models?: ModelInfo[];
  installed?: boolean;
}

const DEFAULT_MODELS: ModelInfo[] = [
  { id: "fake-default", label: "Fake Default", contextWindow: 200_000 },
  { id: "fake-fast", label: "Fake Fast", contextWindow: 64_000 },
];

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Scripted `EngineDriver` (plan §5 WS0 fakes list): an "always reply" loop mode
 * and a "chatty" mode that calls `message_user` often, with zero real
 * credentials or subprocesses. Every other workstream's tests/CI drive their
 * bots through this instead of `packages/engines/claude`/`codex`.
 */
export class FakeEngineDriver implements EngineDriver {
  readonly id = "fake";

  private readonly mode: FakeEngineMode;
  private readonly replies: string[];
  private readonly chattyMessageCount: number;
  private readonly models: ModelInfo[];
  private readonly installed: boolean;
  private replyIndex = 0;
  private disposed = false;

  constructor(options: FakeEngineOptions = {}) {
    this.mode = options.mode ?? "loop";
    this.replies = options.replies?.length ? options.replies : ["Sure, I can help with that."];
    this.chattyMessageCount = options.chattyMessageCount ?? 3;
    this.models = options.models ?? DEFAULT_MODELS;
    this.installed = options.installed ?? true;
  }

  private nextReply(): string {
    const reply = this.replies[this.replyIndex % this.replies.length] ?? this.replies[0] ?? "";
    this.replyIndex += 1;
    return reply;
  }

  async detect(): Promise<EngineStatus> {
    return {
      installed: this.installed,
      version: "0.0.0-fake",
      login: { ok: true, account: "fake-account" },
      apiKey: { ok: true },
    };
  }

  async validateKey(key: string): Promise<{ ok: boolean; reason?: string }> {
    if (key.trim().length === 0) return { ok: false, reason: "empty key" };
    return { ok: true };
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models;
  }

  startTurn(input: TurnInput, hooks: TurnHooks): TurnHandle {
    let interrupted = false;
    const steeredTexts: string[] = [];
    const sessionId = input.sessionId ?? `fake_${ulid()}`;

    const done = (async (): Promise<TurnResult> => {
      hooks.emit({ type: "session_started", sessionId });
      // Yield a tick so a caller that calls `interrupt()`/`steer()` right after
      // `startTurn()` returns (as any real, out-of-process engine would allow)
      // can still affect this turn before it settles.
      await Promise.resolve();

      if (this.mode === "chatty") {
        for (let i = 0; i < this.chattyMessageCount; i++) {
          if (interrupted) break;
          const toolUseId = `${sessionId}_tool_${i}`;
          const text = `(chatty update ${i + 1}/${this.chattyMessageCount}) still working on: ${input.text}`;
          hooks.emit({
            type: "tool_started",
            toolName: "message_user",
            input: { text },
            toolUseId,
          });
          hooks.emit({
            type: "tool_completed",
            toolUseId,
            output: { delivered: true },
            isError: false,
          });
          await Promise.resolve();
        }
      }

      await this.runDirectives(input, hooks, sessionId, () => interrupted);

      const replyText = interrupted
        ? "(interrupted before replying)"
        : [this.nextReply(), ...steeredTexts.map((t) => `(steered: ${t})`)].join(" ");
      hooks.emit({ type: "text_delta", text: replyText });

      const usage = {
        inputTokens: estimateTokens(input.text),
        outputTokens: estimateTokens(replyText),
      };
      hooks.emit({
        type: "usage",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });

      return {
        sessionId,
        isError: interrupted,
        errorMessage: interrupted ? "interrupted" : undefined,
        usage,
      };
    })();

    return {
      steer: async (text: string) => {
        steeredTexts.push(text);
      },
      interrupt: async () => {
        interrupted = true;
      },
      done,
    };
  }

  /**
   * Scripted tool use for E2E tests, one directive per line of the user text:
   * `@tool <name> <json>` calls an OpenBot MCP tool through the `openbot`
   * server injected for the turn (as a real engine's MCP client would), and
   * `@approve <tool> <json>` asks permission for an engine-native tool, and
   * `@servers` writes the names of the turn's injected MCP servers.
   */
  private async runDirectives(
    input: TurnInput,
    hooks: TurnHooks,
    sessionId: string,
    isInterrupted: () => boolean,
  ): Promise<void> {
    const directives = parseDirectives(input.text);
    for (const [index, directive] of directives.entries()) {
      if (isInterrupted()) return;
      const toolUseId = `${sessionId}_directive_${index}`;
      if (directive.kind === "servers") {
        // Test hook: which MCP servers the harness injected into this turn.
        hooks.emit({
          type: "text_delta",
          text: `[mcp servers: ${input.mcpServers.map((s) => s.name).join(", ")}] `,
        });
        continue;
      }
      if (directive.kind === "approve") {
        await hooks.requestApproval({ toolName: directive.name, input: directive.args, toolUseId });
        continue;
      }
      // Named like Claude reports MCP tools, so the runtime treats it as an MCP call.
      const toolName = `mcp__openbot__${directive.name}`;
      hooks.emit({ type: "tool_started", toolName, input: directive.args, toolUseId });
      const server = input.mcpServers.find((s) => s.name === "openbot");
      let output: unknown;
      let isError: boolean;
      if (!server?.env?.OPENBOT_API_URL || !server.env.OPENBOT_SESSION_TOKEN) {
        output = { error: "no openbot MCP server for this turn" };
        isError = true;
      } else {
        try {
          const res = await fetch(
            `${server.env.OPENBOT_API_URL}/internal/tools/${directive.name}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-openbot-session": server.env.OPENBOT_SESSION_TOKEN,
              },
              body: JSON.stringify(directive.args),
            },
          );
          output = await res.json();
          isError = !res.ok;
        } catch (error) {
          output = { error: String(error) };
          isError = true;
        }
      }
      hooks.emit({ type: "tool_completed", toolUseId, output, isError });
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

interface Directive {
  kind: "tool" | "approve" | "servers";
  name: string;
  args: Record<string, unknown>;
}

function parseDirectives(text: string): Directive[] {
  const directives: Directive[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "@servers") {
      directives.push({ kind: "servers", name: "servers", args: {} });
      continue;
    }
    const match = /^@(tool|approve)\s+([\w.-]+)\s*(\{.*\})?\s*$/.exec(line.trim());
    if (!match) continue;
    let args: Record<string, unknown>;
    try {
      args = match[3] ? (JSON.parse(match[3]) as Record<string, unknown>) : {};
    } catch {
      continue;
    }
    directives.push({ kind: match[1] as Directive["kind"], name: match[2]!, args });
  }
  return directives;
}
