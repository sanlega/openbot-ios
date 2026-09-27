import type { EngineSession } from "@openbot/contracts";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { engineSessions } from "./schema.js";

type EngineSessionRow = typeof engineSessions.$inferSelect;

export class EngineSessionsRepo {
  constructor(private readonly db: Db) {}

  create(session: EngineSession): void {
    this.db
      .insert(engineSessions)
      .values({
        id: session.id,
        botId: session.botId,
        engine: session.engine,
        sessionId: session.sessionId,
        createdAt: new Date(session.createdAt),
        lastUsedAt: new Date(session.lastUsedAt),
      })
      .run();
  }

  getForBotAndEngine(botId: string, engine: string): EngineSession | undefined {
    const row = this.db
      .select()
      .from(engineSessions)
      .where(and(eq(engineSessions.botId, botId), eq(engineSessions.engine, engine)))
      .get();
    return row ? toSession(row) : undefined;
  }

  /** Keeps exactly one session row per Bot+engine, pointing at the latest session id. */
  upsert(input: { id: string; botId: string; engine: string; sessionId: string; at: Date }): void {
    const existing = this.getForBotAndEngine(input.botId, input.engine);
    if (existing) {
      this.db
        .update(engineSessions)
        .set({ sessionId: input.sessionId, lastUsedAt: input.at })
        .where(eq(engineSessions.id, existing.id))
        .run();
      return;
    }
    this.db
      .insert(engineSessions)
      .values({
        id: input.id,
        botId: input.botId,
        engine: input.engine,
        sessionId: input.sessionId,
        createdAt: input.at,
        lastUsedAt: input.at,
      })
      .run();
  }

  deleteForBotAndEngine(botId: string, engine: string): void {
    this.db
      .delete(engineSessions)
      .where(and(eq(engineSessions.botId, botId), eq(engineSessions.engine, engine)))
      .run();
  }

  touch(id: string, at: Date): void {
    this.db.update(engineSessions).set({ lastUsedAt: at }).where(eq(engineSessions.id, id)).run();
  }
}

function toSession(row: EngineSessionRow): EngineSession {
  return {
    id: row.id,
    botId: row.botId,
    engine: row.engine as EngineSession["engine"],
    sessionId: row.sessionId,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
  };
}
