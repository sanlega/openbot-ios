import type { Chain } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { chains } from "./schema.js";

type ChainRow = typeof chains.$inferSelect;

/** Loop-guard/limit counters and status per plan §4.1; WS2 owns the guard logic, this is just storage. */
export class ChainsRepo {
  constructor(private readonly db: Db) {}

  create(chain: Chain): void {
    this.db
      .insert(chains)
      .values({
        id: chain.id,
        origin: chain.origin,
        mode: chain.mode,
        routineRunId: chain.routineRunId,
        status: chain.status,
        routineDepth: chain.routineDepth,
        botMessages: chain.botMessages,
        turns: chain.turns,
        usd: chain.usd,
        tokens: chain.tokens,
        computerSteps: chain.computerSteps,
        wallMin: chain.wallMin,
        createdAt: new Date(chain.createdAt),
      })
      .run();
  }

  getById(id: string): Chain | undefined {
    const row = this.db.select().from(chains).where(eq(chains.id, id)).get();
    return row ? toChain(row) : undefined;
  }

  list(): Chain[] {
    return this.db.select().from(chains).all().map(toChain);
  }

  setStatus(id: string, status: Chain["status"]): void {
    this.db.update(chains).set({ status }).where(eq(chains.id, id)).run();
  }

  /** Applies deltas from a completed turn/step (usage, hop, etc.) atomically. */
  incrementCounters(
    id: string,
    delta: Partial<
      Pick<Chain, "botMessages" | "turns" | "usd" | "tokens" | "computerSteps" | "wallMin">
    >,
  ): void {
    const current = this.getById(id);
    if (!current) return;
    this.db
      .update(chains)
      .set({
        botMessages: current.botMessages + (delta.botMessages ?? 0),
        turns: current.turns + (delta.turns ?? 0),
        usd: current.usd + (delta.usd ?? 0),
        tokens: current.tokens + (delta.tokens ?? 0),
        computerSteps: current.computerSteps + (delta.computerSteps ?? 0),
        wallMin: current.wallMin + (delta.wallMin ?? 0),
      })
      .where(eq(chains.id, id))
      .run();
  }
}

function toChain(row: ChainRow): Chain {
  return {
    id: row.id,
    origin: row.origin as Chain["origin"],
    mode: row.mode as Chain["mode"],
    routineRunId: row.routineRunId ?? undefined,
    status: row.status as Chain["status"],
    routineDepth: row.routineDepth,
    botMessages: row.botMessages,
    turns: row.turns,
    usd: row.usd,
    tokens: row.tokens,
    computerSteps: row.computerSteps,
    wallMin: row.wallMin,
    createdAt: row.createdAt.toISOString(),
  };
}
