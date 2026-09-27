import type { Decision } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { decisions } from "./schema.js";

type DecisionRow = typeof decisions.$inferSelect;

/** Persists `Decision` rows written by WS7's `DecisionLog`. */
export class DecisionsRepo {
  constructor(private readonly db: Db) {}

  insert(decision: Decision): void {
    this.db
      .insert(decisions)
      .values({
        id: decision.id,
        purpose: decision.purpose,
        provider: decision.provider,
        model: decision.model,
        stateHash: decision.stateHash,
        answers: decision.answers,
        thresholds: decision.thresholds,
        band: decision.band,
        outcome: decision.outcome,
        feedback: decision.feedback,
        requestId: decision.requestId,
        createdAt: new Date(decision.createdAt),
      })
      .run();
  }

  getById(id: string): Decision | undefined {
    const row = this.db.select().from(decisions).where(eq(decisions.id, id)).get();
    return row ? toDecision(row) : undefined;
  }

  listByPurpose(purpose: string, limit = 100): Decision[] {
    return this.db
      .select()
      .from(decisions)
      .where(eq(decisions.purpose, purpose))
      .limit(limit)
      .all()
      .map(toDecision);
  }
}

function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    purpose: row.purpose,
    provider: row.provider as Decision["provider"],
    model: row.model,
    stateHash: row.stateHash,
    answers: row.answers,
    thresholds: row.thresholds ?? undefined,
    band: row.band as Decision["band"],
    outcome: row.outcome as Decision["outcome"],
    feedback: (row.feedback as Decision["feedback"]) ?? undefined,
    requestId: row.requestId ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}
