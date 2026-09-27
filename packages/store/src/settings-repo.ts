import type { Settings } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { settings } from "./schema.js";

type SettingsRow = typeof settings.$inferSelect;
const SINGLETON_ID = "singleton";

/** Single settings row: caps S1-S10/O7, purpose budgets (O4), quiet hours (S7). Owner-only to write (plan §4.7). */
export class SettingsRepo {
  constructor(private readonly db: Db) {}

  get(): Settings | undefined {
    const row = this.db.select().from(settings).where(eq(settings.id, SINGLETON_ID)).get();
    return row ? toSettings(row) : undefined;
  }

  upsert(next: Settings): void {
    this.db
      .insert(settings)
      .values({
        id: SINGLETON_ID,
        caps: next.caps,
        budgets: next.budgets,
        quietHours: next.quietHours,
        updatedAt: new Date(next.updatedAt),
      })
      .onConflictDoUpdate({
        target: settings.id,
        set: {
          caps: next.caps,
          budgets: next.budgets,
          quietHours: next.quietHours,
          updatedAt: new Date(next.updatedAt),
        },
      })
      .run();
  }
}

function toSettings(row: SettingsRow): Settings {
  return {
    id: "singleton",
    caps: row.caps,
    budgets: row.budgets,
    quietHours: row.quietHours ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
  };
}
