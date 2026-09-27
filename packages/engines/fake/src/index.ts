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

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
