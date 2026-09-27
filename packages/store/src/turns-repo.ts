import type { Turn } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { turns } from "./schema.js";

type TurnRow = typeof turns.$inferSelect;

export class TurnsRepo {
  constructor(private readonly db: Db) {}

  create(turn: Turn): void {
    this.db
      .insert(turns)
      .values({
        id: turn.id,
        botId: turn.botId,
        chainId: turn.chainId,
        engine: turn.engine,
        model: turn.model,
        effort: turn.effort,
        routeDecisionId: turn.routeDecisionId,
        sessionId: turn.sessionId,
        status: turn.status,
        usage: turn.usage,
        createdAt: new Date(turn.createdAt),
      })
      .run();
  }

  getById(id: string): Turn | undefined {
    const row = this.db.select().from(turns).where(eq(turns.id, id)).get();
    return row ? toTurn(row) : undefined;
  }

  listByChain(chainId: string): Turn[] {
    return this.db.select().from(turns).where(eq(turns.chainId, chainId)).all().map(toTurn);
  }

  listByBot(botId: string): Turn[] {
    return this.db.select().from(turns).where(eq(turns.botId, botId)).all().map(toTurn);
  }

  setSessionId(id: string, sessionId: string): void {
    this.db.update(turns).set({ sessionId }).where(eq(turns.id, id)).run();
  }

  updateStatus(id: string, status: Turn["status"], usage?: Turn["usage"]): void {
    this.db
      .update(turns)
      .set({ status, ...(usage ? { usage } : {}) })
      .where(eq(turns.id, id))
      .run();
  }
}

function toTurn(row: TurnRow): Turn {
  return {
    id: row.id,
    botId: row.botId,
    chainId: row.chainId,
    engine: row.engine as Turn["engine"],
    model: row.model,
    effort: (row.effort as Turn["effort"]) ?? undefined,
    routeDecisionId: row.routeDecisionId ?? undefined,
    sessionId: row.sessionId ?? undefined,
    status: row.status as Turn["status"],
    usage: row.usage,
    createdAt: row.createdAt.toISOString(),
  };
}
