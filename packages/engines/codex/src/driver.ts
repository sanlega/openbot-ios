import type {
  EngineDriver,
  EngineStatus,
  ModelInfo,
  TurnHandle,
  TurnHooks,
  TurnInput,
} from "@openbot/contracts";
import { loadFixture, validateOpenAiKey, waitForTurnComplete } from "@openbot/engines-common";
import { CodexAppServer, FixtureCodexAppServer } from "./app-server.js";
import { detectCodex } from "./detect.js";
import { CODEX_MODELS } from "./models.js";
import { createCodexParseState, toCodexTurnResult } from "./parse-events.js";

let sharedAppServer: CodexAppServer | null = null;

export interface CodexDriverOptions {
  appServer?: CodexAppServer | FixtureCodexAppServer;
  fixtureReplay?: string;
}

/**
 * One shared `codex app-server` with per-thread MCP via `thread/start` (plan §5 WS3).
 */
export class CodexDriver implements EngineDriver {
  readonly id = "codex";

  private readonly appServer: CodexAppServer | FixtureCodexAppServer;
  private readonly threadByBot = new Map<string, string>();
  private disposed = false;

  constructor(options: CodexDriverOptions = {}) {
    if (options.appServer) {
      this.appServer = options.appServer;
    } else if (options.fixtureReplay) {
      this.appServer = new FixtureCodexAppServer(options.fixtureReplay, loadFixture);
    } else {
      if (!sharedAppServer) {
        sharedAppServer = new CodexAppServer();
      }
      this.appServer = sharedAppServer;
    }
  }

  async detect(): Promise<EngineStatus> {
    return detectCodex();
  }

  async validateKey(key: string): Promise<{ ok: boolean; reason?: string }> {
    return validateOpenAiKey(key);
  }

  async listModels(): Promise<ModelInfo[]> {
    return CODEX_MODELS;
  }

  startTurn(input: TurnInput, hooks: TurnHooks): TurnHandle {
    const botKey = input.bot.id;
    let interrupted = false;
    const state = createCodexParseState();

    const done = (async () => {
      let threadId = input.sessionId ?? this.threadByBot.get(botKey);
      if (!threadId) {
        threadId = input.sessionId
          ? await this.appServer.threadResume(input.sessionId)
          : await this.appServer.threadStart(input);
        this.threadByBot.set(botKey, threadId);
      }

      state.threadId = threadId;
      state.sessionId = threadId;
      hooks.emit({ type: "session_started", sessionId: threadId });

      let lastActivityAt = Date.now();
      const unsubscribe = this.appServer.watchTurn(state, {
        ...hooks,
        emit: (event) => {
          lastActivityAt = Date.now();
          hooks.emit(event);
        },
      });
      const turnId = await this.appServer.turnStart(threadId, input.text);
      state.turnId = turnId;

      await waitForTurnComplete(
        state,
        () => interrupted,
        () => lastActivityAt,
      );
      unsubscribe();

      if (interrupted) {
        await this.appServer.turnInterrupt(threadId, turnId);
        return {
          sessionId: threadId,
          isError: true,
          errorMessage: "interrupted",
          usage: state.usage,
        };
      }

      return toCodexTurnResult(state);
    })();

    return {
      steer: async (text: string) => {
        const threadId = this.threadByBot.get(botKey);
        if (threadId && state.turnId) {
          await this.appServer.turnSteer(threadId, state.turnId, text);
        }
      },
      interrupt: async () => {
        interrupted = true;
        const threadId = this.threadByBot.get(botKey);
        if (threadId && state.turnId) {
          await this.appServer.turnInterrupt(threadId, state.turnId);
        }
      },
      done,
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.appServer instanceof FixtureCodexAppServer) {
      await this.appServer.dispose();
    }
    this.threadByBot.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Exposed for MCP isolation tests. */
  get server(): CodexAppServer | FixtureCodexAppServer {
    return this.appServer;
  }
}

export function createFixtureCodexDriver(fixtureReplay: string): CodexDriver {
  return new CodexDriver({ fixtureReplay });
}

export function resetSharedCodexAppServerForTests(): void {
  sharedAppServer = null;
}
