import type { ComputerTask } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { computerTasks } from "./schema.js";

type ComputerTaskRow = typeof computerTasks.$inferSelect;

export class ComputerTasksRepo {
  constructor(private readonly db: Db) {}

  create(task: ComputerTask): void {
    this.db
      .insert(computerTasks)
      .values({
        id: task.id,
        botId: task.botId,
        chainId: task.chainId,
        goal: task.goal,
        provider: task.provider,
        status: task.status,
        steps: task.steps,
        usd: task.usd,
        createdAt: new Date(task.createdAt),
      })
      .run();
  }

  getById(id: string): ComputerTask | undefined {
    const row = this.db.select().from(computerTasks).where(eq(computerTasks.id, id)).get();
    return row ? toTask(row) : undefined;
  }

  listByBot(botId: string): ComputerTask[] {
    return this.db
      .select()
      .from(computerTasks)
      .where(eq(computerTasks.botId, botId))
      .all()
      .map(toTask);
  }

  list(): ComputerTask[] {
    return this.db.select().from(computerTasks).all().map(toTask);
  }

  update(id: string, patch: Partial<Pick<ComputerTask, "status" | "steps" | "usd">>): void {
    this.db.update(computerTasks).set(patch).where(eq(computerTasks.id, id)).run();
  }
}

function toTask(row: ComputerTaskRow): ComputerTask {
  return {
    id: row.id,
    botId: row.botId,
    chainId: row.chainId,
    goal: row.goal,
    provider: row.provider as ComputerTask["provider"],
    status: row.status as ComputerTask["status"],
    steps: row.steps,
    usd: row.usd,
    createdAt: row.createdAt.toISOString(),
  };
}
