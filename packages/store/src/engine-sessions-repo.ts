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
