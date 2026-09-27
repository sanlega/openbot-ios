import type { TriggerEvent } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { triggerEvents } from "./schema.js";

type TriggerEventRow = typeof triggerEvents.$inferSelect;

export class TriggerEventsRepo {
  constructor(private readonly db: Db) {}

  create(event: TriggerEvent): void {
    this.db
      .insert(triggerEvents)
      .values({
        id: event.id,
        source: event.source,
        routineId: event.routineId,
        payloadHash: event.payloadHash,
        payloadRef: event.payloadRef,
        matched: event.matched,
        matchDecisionId: event.matchDecisionId,
        receivedAt: new Date(event.receivedAt),
      })
      .run();
  }

  getById(id: string): TriggerEvent | undefined {
    const row = this.db.select().from(triggerEvents).where(eq(triggerEvents.id, id)).get();
    return row ? toEvent(row) : undefined;
  }

  /** Used for dedupe-by-`payloadHash` (plan §5 WS12 matching step 1). */
  findByPayloadHash(routineId: string, payloadHash: string): TriggerEvent | undefined {
    const row = this.db
      .select()
      .from(triggerEvents)
      .where(eq(triggerEvents.payloadHash, payloadHash))
      .get();
    return row && row.routineId === routineId ? toEvent(row) : undefined;
  }

  listByRoutine(routineId: string): TriggerEvent[] {
    return this.db
      .select()
      .from(triggerEvents)
      .where(eq(triggerEvents.routineId, routineId))
      .all()
      .map(toEvent);
  }
}

function toEvent(row: TriggerEventRow): TriggerEvent {
  return {
    id: row.id,
    source: row.source,
    routineId: row.routineId,
    payloadHash: row.payloadHash,
    payloadRef: row.payloadRef,
    matched: row.matched,
    matchDecisionId: row.matchDecisionId ?? undefined,
    receivedAt: row.receivedAt.toISOString(),
  };
}
