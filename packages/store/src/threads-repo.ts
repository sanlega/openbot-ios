import type { Thread } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { threads } from "./schema.js";

type ThreadRow = typeof threads.$inferSelect;

/** One DM thread per Bot (plan §4.1). */
export class ThreadsRepo {
  constructor(private readonly db: Db) {}

  create(thread: Thread): void {
    this.db
      .insert(threads)
      .values({
        id: thread.id,
        botId: thread.botId,
        kind: thread.kind,
        createdAt: new Date(thread.createdAt),
      })
      .run();
  }

  getById(id: string): Thread | undefined {
    const row = this.db.select().from(threads).where(eq(threads.id, id)).get();
    return row ? toThread(row) : undefined;
  }

  getByBotId(botId: string): Thread | undefined {
    const row = this.db.select().from(threads).where(eq(threads.botId, botId)).get();
    return row ? toThread(row) : undefined;
  }

  list(): Thread[] {
    return this.db.select().from(threads).all().map(toThread);
  }
}

function toThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    botId: row.botId,
    kind: "dm",
    createdAt: row.createdAt.toISOString(),
  };
}
