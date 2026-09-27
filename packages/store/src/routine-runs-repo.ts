import type { RoutineRun } from "@openbot/contracts";
import { desc, eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { routineRuns } from "./schema.js";

type RoutineRunRow = typeof routineRuns.$inferSelect;

export class RoutineRunsRepo {
  constructor(private readonly db: Db) {}

  create(run: RoutineRun): void {
    this.db
      .insert(routineRuns)
      .values({
        id: run.id,
        routineId: run.routineId,
        chainId: run.chainId,
        cause: run.cause,
        triggerEventIds: run.triggerEventIds,
        dryRun: run.dryRun,
        status: run.status,
        skipReason: run.skipReason,
        usage: run.usage,
        resultSummary: run.resultSummary,
        plannedActions: run.plannedActions,
        startedAt: run.startedAt ? new Date(run.startedAt) : undefined,
        endedAt: run.endedAt ? new Date(run.endedAt) : undefined,
      })
      .run();
  }

  getById(id: string): RoutineRun | undefined {
    const row = this.db.select().from(routineRuns).where(eq(routineRuns.id, id)).get();
    return row ? toRun(row) : undefined;
  }

  /** Most recent runs for a routine first (plan §5 WS12: "history: the last 50 runs per routine"). */
  listByRoutine(routineId: string, limit = 50): RoutineRun[] {
    return this.db
      .select()
      .from(routineRuns)
      .where(eq(routineRuns.routineId, routineId))
      .orderBy(desc(routineRuns.startedAt))
      .limit(limit)
      .all()
      .map(toRun);
  }

  update(
    id: string,
    patch: Partial<{
      status: RoutineRun["status"];
      skipReason: string;
      usage: RoutineRun["usage"];
      resultSummary: string;
      plannedActions: string[];
      startedAt: string;
      endedAt: string;
    }>,
  ): void {
    this.db
      .update(routineRuns)
      .set({
        ...patch,
        startedAt: patch.startedAt ? new Date(patch.startedAt) : undefined,
        endedAt: patch.endedAt ? new Date(patch.endedAt) : undefined,
      })
      .where(eq(routineRuns.id, id))
      .run();
  }
}

function toRun(row: RoutineRunRow): RoutineRun {
  return {
    id: row.id,
    routineId: row.routineId,
    chainId: row.chainId,
    cause: row.cause as RoutineRun["cause"],
    triggerEventIds: row.triggerEventIds,
    dryRun: row.dryRun,
    status: row.status as RoutineRun["status"],
    skipReason: row.skipReason ?? undefined,
    usage: row.usage,
    resultSummary: row.resultSummary ?? undefined,
    plannedActions: row.plannedActions ?? undefined,
    startedAt: row.startedAt?.toISOString(),
    endedAt: row.endedAt?.toISOString(),
  };
}
