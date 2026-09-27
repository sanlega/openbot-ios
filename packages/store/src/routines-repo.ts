import type { Routine } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { routines } from "./schema.js";

type RoutineRow = typeof routines.$inferSelect;

export class RoutinesRepo {
  constructor(private readonly db: Db) {}

  create(routine: Routine): void {
    this.db
      .insert(routines)
      .values({
        id: routine.id,
        botId: routine.botId,
        name: routine.name,
        prompt: routine.prompt,
        createdBy: routine.createdBy,
        enabled: routine.enabled,
        liveApproved: routine.liveApproved,
        trigger: routine.trigger,
        limits: routine.limits,
        pausedReason: routine.pausedReason,
        consecutiveFailures: routine.consecutiveFailures,
        lastRunAt: routine.lastRunAt ? new Date(routine.lastRunAt) : undefined,
        createdAt: new Date(routine.createdAt),
      })
      .run();
  }

  getById(id: string): Routine | undefined {
    const row = this.db.select().from(routines).where(eq(routines.id, id)).get();
    return row ? toRoutine(row) : undefined;
  }

  listByBot(botId: string): Routine[] {
    return this.db.select().from(routines).where(eq(routines.botId, botId)).all().map(toRoutine);
  }

  list(): Routine[] {
    return this.db.select().from(routines).all().map(toRoutine);
  }

  update(
    id: string,
    patch: Partial<{
      name: string;
      prompt: string;
      enabled: boolean;
      liveApproved: boolean;
      trigger: Routine["trigger"];
      limits: Routine["limits"];
      pausedReason: string | undefined;
      consecutiveFailures: number;
      lastRunAt: string;
    }>,
  ): void {
    this.db
      .update(routines)
      .set({
        ...patch,
        lastRunAt: patch.lastRunAt ? new Date(patch.lastRunAt) : undefined,
      })
      .where(eq(routines.id, id))
      .run();
  }

  delete(id: string): void {
    this.db.delete(routines).where(eq(routines.id, id)).run();
  }
}

function toRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    botId: row.botId,
    name: row.name,
    prompt: row.prompt,
    createdBy: row.createdBy,
    enabled: row.enabled,
    liveApproved: row.liveApproved,
    trigger: row.trigger,
    limits: row.limits,
    pausedReason: row.pausedReason ?? undefined,
    consecutiveFailures: row.consecutiveFailures,
    lastRunAt: row.lastRunAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
