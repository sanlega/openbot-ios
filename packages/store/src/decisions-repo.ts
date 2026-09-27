import type { Decision } from "@openbot/contracts";
<<<<<<< HEAD
import { and, desc, eq } from "drizzle-orm";
=======
import { eq } from "drizzle-orm";
>>>>>>> origin/cursor/ws7-decision-service-43da
import type { Db } from "./db.js";
import { decisions } from "./schema.js";

type DecisionRow = typeof decisions.$inferSelect;

<<<<<<< HEAD
export interface DecisionListFilter {
  purpose?: string;
  limit?: number;
  before?: string;
}

/** Audit log of every `DecisionService.decide()` call (plan §4.7 `decisions?purpose&cursor`). */
export class DecisionsRepo {
  constructor(private readonly db: Db) {}

  create(decision: Decision): void {
=======
/** Persists `Decision` rows written by WS7's `DecisionLog`. */
export class DecisionsRepo {
  constructor(private readonly db: Db) {}

  insert(decision: Decision): void {
>>>>>>> origin/cursor/ws7-decision-service-43da
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

<<<<<<< HEAD
  setFeedback(id: string, feedback: "promote" | "mute"): void {
    this.db.update(decisions).set({ feedback }).where(eq(decisions.id, id)).run();
  }

  list(filter: DecisionListFilter = {}): Decision[] {
    const conditions = [];
    if (filter.purpose) conditions.push(eq(decisions.purpose, filter.purpose));
    const rows = this.db
      .select()
      .from(decisions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(decisions.createdAt))
      .limit(filter.limit ?? 100)
      .all();
    return rows.map(toDecision);
=======
  listByPurpose(purpose: string, limit = 100): Decision[] {
    return this.db
      .select()
      .from(decisions)
      .where(eq(decisions.purpose, purpose))
      .limit(limit)
      .all()
      .map(toDecision);
>>>>>>> origin/cursor/ws7-decision-service-43da
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
