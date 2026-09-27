import type { InputAnswer, InputRequest } from "@openbot/contracts";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { inputRequests } from "./schema.js";

type InputRequestRow = typeof inputRequests.$inferSelect;

/** `ask_user` form requests (see `@openbot/contracts` `InputRequest`). */
export class InputRequestsRepo {
  constructor(private readonly db: Db) {}

  create(request: InputRequest): void {
    this.db
      .insert(inputRequests)
      .values({
        id: request.id,
        botId: request.botId,
        threadId: request.threadId,
        chainId: request.chainId,
        title: request.title,
        intro: request.intro,
        fields: request.fields,
        status: request.status,
        answers: request.answers,
        createdAt: new Date(request.createdAt),
        resolvedAt: request.resolvedAt ? new Date(request.resolvedAt) : undefined,
      })
      .run();
  }

  getById(id: string): InputRequest | undefined {
    const row = this.db.select().from(inputRequests).where(eq(inputRequests.id, id)).get();
    return row ? toInputRequest(row) : undefined;
  }

  /** Newest first. */
  list(filter: { status?: InputRequest["status"]; botId?: string } = {}): InputRequest[] {
    const conditions = [
      filter.status ? eq(inputRequests.status, filter.status) : undefined,
      filter.botId ? eq(inputRequests.botId, filter.botId) : undefined,
    ].filter((c) => c !== undefined);
    return this.db
      .select()
      .from(inputRequests)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(inputRequests.createdAt))
      .all()
      .map(toInputRequest);
  }

  /** Moves a pending request to its final state; returns false if it was no longer pending. */
  resolve(
    id: string,
    status: Exclude<InputRequest["status"], "pending">,
    at: Date,
    answers?: Record<string, InputAnswer>,
  ): boolean {
    const result = this.db
      .update(inputRequests)
      .set({ status, resolvedAt: at, ...(answers ? { answers } : {}) })
      .where(and(eq(inputRequests.id, id), eq(inputRequests.status, "pending")))
      .run();
    return result.changes > 0;
  }
}

function toInputRequest(row: InputRequestRow): InputRequest {
  return {
    id: row.id,
    botId: row.botId,
    threadId: row.threadId,
    chainId: row.chainId ?? undefined,
    title: row.title,
    intro: row.intro ?? undefined,
    fields: row.fields,
    status: row.status as InputRequest["status"],
    answers: row.answers ?? undefined,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
  };
}
