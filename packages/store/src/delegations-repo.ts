import type { Delegation, DelegationState } from "@openbot/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "./db.js";
import { delegations } from "./schema.js";

type Row = typeof delegations.$inferSelect;

export const OPEN_DELEGATION_STATES: DelegationState[] = ["submitted", "working", "input_required"];

/** Tasks handed from one Bot to another (see `@openbot/contracts` `Delegation`). */
export class DelegationsRepo {
  constructor(private readonly db: Db) {}

  create(d: Delegation): void {
    this.db
      .insert(delegations)
      .values({
        id: d.id,
        chainId: d.chainId,
        requesterBotId: d.requesterBotId,
        assigneeBotId: d.assigneeBotId,
        ownerThreadId: d.ownerThreadId,
        title: d.title,
        state: d.state,
        statusMessage: d.statusMessage,
        result: d.result,
        engine: d.engine,
        roundTrips: d.roundTrips,
        wakePending: d.wakePending,
        wakeKind: d.wakeKind,
        createdAt: new Date(d.createdAt),
        updatedAt: new Date(d.updatedAt),
        lastEventAt: new Date(d.lastEventAt),
      })
      .run();
  }

  getById(id: string): Delegation | undefined {
    const row = this.db.select().from(delegations).where(eq(delegations.id, id)).get();
    return row ? toDelegation(row) : undefined;
  }

  update(
    id: string,
    patch: Partial<Omit<Delegation, "id" | "createdAt" | "updatedAt">>,
    now: Date,
  ): Delegation | undefined {
    const set: Partial<typeof delegations.$inferInsert> = { updatedAt: now };
    if (patch.state !== undefined) set.state = patch.state;
    if ("statusMessage" in patch) set.statusMessage = patch.statusMessage ?? null;
    if ("result" in patch) set.result = patch.result ?? null;
    if ("engine" in patch) set.engine = patch.engine ?? null;
    if (patch.roundTrips !== undefined) set.roundTrips = patch.roundTrips;
    if (patch.wakePending !== undefined) set.wakePending = patch.wakePending;
    if ("wakeKind" in patch) set.wakeKind = patch.wakeKind ?? null;
    if (patch.lastEventAt) set.lastEventAt = new Date(patch.lastEventAt);
    this.db.update(delegations).set(set).where(eq(delegations.id, id)).run();
    return this.getById(id);
  }

  /** Takes the owed wake: true for exactly one caller, so a wake is delivered once. */
  claimWake(id: string): boolean {
    const result = this.db
      .update(delegations)
      .set({ wakePending: false })
      .where(and(eq(delegations.id, id), eq(delegations.wakePending, true)))
      .run();
    return result.changes > 0;
  }

  /** The newest open delegation this Bot is working on. */
  findOpenForAssignee(assigneeBotId: string): Delegation | undefined {
    const row = this.db
      .select()
      .from(delegations)
      .where(
        and(
          eq(delegations.assigneeBotId, assigneeBotId),
          inArray(delegations.state, OPEN_DELEGATION_STATES),
        ),
      )
      .orderBy(desc(delegations.createdAt))
      .get();
    return row ? toDelegation(row) : undefined;
  }

  /** The open delegation from `requester` to `assignee`, if any (a follow-up continues it). */
  findOpenBetween(requesterBotId: string, assigneeBotId: string): Delegation | undefined {
    const row = this.db
      .select()
      .from(delegations)
      .where(
        and(
          eq(delegations.requesterBotId, requesterBotId),
          eq(delegations.assigneeBotId, assigneeBotId),
          inArray(delegations.state, OPEN_DELEGATION_STATES),
        ),
      )
      .orderBy(desc(delegations.createdAt))
      .get();
    return row ? toDelegation(row) : undefined;
  }

  list(
    filter: { requesterBotId?: string; assigneeBotId?: string; open?: boolean } = {},
  ): Delegation[] {
    const conditions = [
      filter.requesterBotId ? eq(delegations.requesterBotId, filter.requesterBotId) : undefined,
      filter.assigneeBotId ? eq(delegations.assigneeBotId, filter.assigneeBotId) : undefined,
      filter.open ? inArray(delegations.state, OPEN_DELEGATION_STATES) : undefined,
    ].filter((c) => c !== undefined);
    return this.db
      .select()
      .from(delegations)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(delegations.createdAt))
      .all()
      .map(toDelegation);
  }

  listWakePending(): Delegation[] {
    return this.db
      .select()
      .from(delegations)
      .where(eq(delegations.wakePending, true))
      .all()
      .map(toDelegation);
  }
}

function toDelegation(row: Row): Delegation {
  return {
    id: row.id,
    chainId: row.chainId,
    requesterBotId: row.requesterBotId,
    assigneeBotId: row.assigneeBotId,
    ownerThreadId: row.ownerThreadId,
    title: row.title,
    state: row.state as DelegationState,
    statusMessage: row.statusMessage ?? undefined,
    result: row.result ?? undefined,
    engine: row.engine ?? undefined,
    roundTrips: row.roundTrips,
    wakePending: row.wakePending,
    wakeKind: row.wakeKind ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastEventAt: row.lastEventAt.toISOString(),
  };
}
