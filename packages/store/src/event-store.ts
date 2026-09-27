import { newId, type OBEvent } from "@openbot/contracts";
import { eq, gt } from "drizzle-orm";
import type { Db } from "./db.js";
import { events } from "./schema.js";

/**
 * Thin append/replay repository over the `events` table — the persistence half of
 * the event bus (plan §4.2/WS1: "persist -> NDJSON -> fan-out, one transaction per
 * event"). WS1 owns the NDJSON mirror and the WebSocket fan-out; this is just the
 * durable, monotonically-`seq`-ordered log they both read from.
 */
export class EventStore {
  constructor(private readonly db: Db) {}

  append(event: Omit<OBEvent, "id" | "seq"> & { id?: string }): OBEvent {
    const id = event.id ?? newId("event");
    const row = this.db
      .insert(events)
      .values({
        id,
        ts: new Date(event.ts),
        type: event.type,
        botId: event.botId,
        threadId: event.threadId,
        turnId: event.turnId,
        chainId: event.chainId,
        payload: event.payload,
      })
      .returning()
      .get();
    return toOBEvent(row);
  }

  /** Replay from `since` (exclusive) — the exact semantics the Client API WebSocket's `{subscribe, since}` needs for gap-free reconnects. */
  listSince(since: number): OBEvent[] {
    const rows = this.db.select().from(events).where(gt(events.seq, since)).all();
    return rows.map(toOBEvent);
  }

  getBySeq(seq: number): OBEvent | undefined {
    const row = this.db.select().from(events).where(eq(events.seq, seq)).get();
    return row ? toOBEvent(row) : undefined;
  }

  count(): number {
    return this.db.select().from(events).all().length;
  }
}

function toOBEvent(row: typeof events.$inferSelect): OBEvent {
  return {
    id: row.id,
    seq: row.seq,
    ts: row.ts.toISOString(),
    type: row.type as OBEvent["type"],
    botId: row.botId ?? undefined,
    threadId: row.threadId ?? undefined,
    turnId: row.turnId ?? undefined,
    chainId: row.chainId ?? undefined,
    payload: row.payload,
  };
}
