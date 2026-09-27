import type {
  EngineDriver,
  EngineEvent,
  EngineStatus,
  ModelInfo,
  TurnHandle,
  TurnHooks,
  TurnInput,
} from "@openbot/contracts";
import { loadFixture, validateAnthropicKey, waitForTurnComplete } from "@openbot/engines-common";
import { detectClaude } from "./detect.js";
import { CLAUDE_MODELS } from "./models.js";
import { createClaudeParseState, handleClaudeLine, toTurnResult } from "./parse-stream-json.js";
import {
  FixtureClaudeTransport,
  SubprocessClaudeTransport,
  type ClaudeTransport,
} from "./transport.js";

export interface ClaudeDriverOptions {
  transport?: ClaudeTransport;
  /** Relative path under `packages/engines/fixtures/` for golden replay tests. */
  fixtureReplay?: string;
}

interface ActiveSession {
  transport: ClaudeTransport;
  handle: Awaited<ReturnType<ClaudeTransport["spawnSession"]>>;
  sessionId?: string;
}

/**
 * Long-lived `claude -p --input-format stream-json` process per Bot session (plan §5 WS3).
 */
export class ClaudeDriver implements EngineDriver {
  readonly id = "claude";

  private readonly transport: ClaudeTransport;
  private readonly sessions = new Map<string, ActiveSession>();
  private disposed = false;

  constructor(options: ClaudeDriverOptions = {}) {
    if (options.transport) {
      this.transport = options.transport;
    } else if (options.fixtureReplay) {
      this.transport = new FixtureClaudeTransport(options.fixtureReplay, loadFixture);
    } else {
      this.transport = new SubprocessClaudeTransport();
    }
  }

  async detect(): Promise<EngineStatus> {
    return detectClaude();
  }

  async validateKey(key: string): Promise<{ ok: boolean; reason?: string }> {
    return validateAnthropicKey(key);
  }

  async listModels(): Promise<ModelInfo[]> {
    return CLAUDE_MODELS;
  }

  startTurn(input: TurnInput, hooks: TurnHooks): TurnHandle {
    const sessionKey = input.sessionId ?? input.bot.id;
    let interrupted = false;
    let steerQueue: string[] = [];

    const done = (async () => {
      const session = await this.ensureSession(sessionKey, input);
      const state = createClaudeParseState();
      let settled = false;
      let lastActivityAt = Date.now();

      const unsubscribe = session.handle.onLine((line) => {
        lastActivityAt = Date.now();
        handleClaudeLine(line, state, hooks);
        if (state.turnComplete && !settled) {
          settled = true;
        }
      });

      session.handle.writeUserMessage(input.text);
      for (const steerText of steerQueue) {
        session.handle.writeUserMessage(steerText);
      }
      steerQueue = [];

      await waitForTurnComplete(
        state,
        () => interrupted,
        () => lastActivityAt,
      );
      unsubscribe();

      if (interrupted) {
        session.handle.interrupt();
        return {
          sessionId: state.sessionId ?? input.sessionId ?? sessionKey,
          isError: true,
          errorMessage: "interrupted",
          usage: state.usage,
        };
      }

      if (state.sessionId) {
        session.sessionId = state.sessionId;
      }
      return toTurnResult(state);
    })();

    return {
      steer: async (text: string) => {
        steerQueue.push(text);
        const session = this.sessions.get(sessionKey);
        session?.handle.writeUserMessage(text);
      },
      interrupt: async () => {
        interrupted = true;
        const session = this.sessions.get(sessionKey);
        session?.handle.interrupt();
      },
      done,
    };
  }

  private async ensureSession(sessionKey: string, input: TurnInput): Promise<ActiveSession> {
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;

    const handle = await this.transport.spawnSession(input, {
      resumeSessionId: input.sessionId,
    });
    const active: ActiveSession = { transport: this.transport, handle };
    this.sessions.set(sessionKey, active);
    return active;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const session of this.sessions.values()) {
      await session.handle.close();
    }
    this.sessions.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

export function createFixtureClaudeDriver(fixtureReplay: string): ClaudeDriver {
  return new ClaudeDriver({ fixtureReplay });
}

export type { EngineEvent };
