import type { Message } from "@openbot/contracts";
import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "./db.js";
import { messages } from "./schema.js";

type MessageRow = typeof messages.$inferSelect;

export interface MessageListFilter {
  threadId?: string;
  delivery?: Message["delivery"];
  botId?: string;
  limit?: number;
}

/** Messages within a thread, including proactive/delivery metadata (plan §4.1). */
export class MessagesRepo {
  constructor(private readonly db: Db) {}

  create(message: Message): void {
    this.db
      .insert(messages)
      .values({
        id: message.id,
        threadId: message.threadId,
        author: message.author,
        text: message.text,
        attachments: message.attachments,
        chainId: message.chainId,
        hop: message.hop,
        replyTo: message.replyTo,
        createdAt: new Date(message.createdAt),
        proactive: message.proactive,
        kind: message.kind,
        options: message.options,
        deadline: message.deadline ? new Date(message.deadline) : undefined,
        dedupeKey: message.dedupeKey,
        delivery: message.delivery,
        pushed: message.pushed,
        notifyDecisionId: message.notifyDecisionId,
        inputRequestId: message.inputRequestId,
      })
      .run();
  }

  getById(id: string): Message | undefined {
    const row = this.db.select().from(messages).where(eq(messages.id, id)).get();
    return row ? toMessage(row) : undefined;
  }

  /** Sets `delivery` (promote -> 'delivered', mute -> stays 'held'); used by the activity log's promote/mute actions. */
  updateDelivery(id: string, delivery: Message["delivery"]): void {
    this.db.update(messages).set({ delivery }).where(eq(messages.id, id)).run();
  }

  list(filter: MessageListFilter = {}): Message[] {
    const conditions = [];
    if (filter.threadId) conditions.push(eq(messages.threadId, filter.threadId));
    if (filter.delivery) conditions.push(eq(messages.delivery, filter.delivery));
    const rows = this.db
      .select()
      .from(messages)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(messages.createdAt))
      .limit(filter.limit ?? 200)
      .all();
    return rows.map(toMessage);
  }

  /** Proactive messages actually delivered at or after `since`, newest first (caps S4/S5, dedupe). */
  listProactiveDeliveredSince(since: Date): Message[] {
    return this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.proactive, true),
          eq(messages.delivery, "delivered"),
          gte(messages.createdAt, since),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .all()
      .map(toMessage);
  }

  findByDedupeKey(dedupeKey: string, withinMs: number, now: Date): Message | undefined {
    const cutoff = new Date(now.getTime() - withinMs);
    const row = this.db
      .select()
      .from(messages)
      .where(eq(messages.dedupeKey, dedupeKey))
      .orderBy(desc(messages.createdAt))
      .get();
    if (!row || row.createdAt < cutoff) return undefined;
    return toMessage(row);
  }
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    threadId: row.threadId,
    author: row.author,
    text: row.text,
    attachments: row.attachments,
    chainId: row.chainId ?? undefined,
    hop: row.hop,
    replyTo: row.replyTo ?? undefined,
    createdAt: row.createdAt.toISOString(),
    proactive: row.proactive,
    kind: (row.kind as Message["kind"]) ?? undefined,
    options: row.options ?? undefined,
    deadline: row.deadline?.toISOString(),
    dedupeKey: row.dedupeKey ?? undefined,
    delivery: row.delivery as Message["delivery"],
    pushed: row.pushed,
    notifyDecisionId: row.notifyDecisionId ?? undefined,
    inputRequestId: row.inputRequestId ?? undefined,
  };
}
