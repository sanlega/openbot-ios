import type { EngineId } from "@openbot/contracts";

/** Maps a Bot+engine to its live engine session id (plan §4.1 `EngineSession`). WS1 backs this with `@openbot/store`'s `engine_sessions` table for real persistence. */
export interface SessionStore {
  get(botId: string, engine: EngineId): string | undefined;
  set(botId: string, engine: EngineId, sessionId: string): void;
  clear(botId: string, engine: EngineId): void;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, string>();

  private key(botId: string, engine: EngineId): string {
    return `${botId}:${engine}`;
  }

  get(botId: string, engine: EngineId): string | undefined {
    return this.sessions.get(this.key(botId, engine));
  }

  set(botId: string, engine: EngineId, sessionId: string): void {
    this.sessions.set(this.key(botId, engine), sessionId);
  }

  clear(botId: string, engine: EngineId): void {
    this.sessions.delete(this.key(botId, engine));
  }
}
