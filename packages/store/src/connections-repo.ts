import type { Connection } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { connections } from "./schema.js";

type ConnectionRow = typeof connections.$inferSelect;

export class ConnectionsRepo {
  constructor(private readonly db: Db) {}

  create(connection: Connection): void {
    this.db
      .insert(connections)
      .values({
        id: connection.id,
        provider: connection.provider,
        appId: connection.appId,
        displayName: connection.displayName,
        status: connection.status,
        toolMeta: connection.toolMeta,
        triggers: connection.triggers,
        createdAt: new Date(connection.createdAt),
      })
      .run();
  }

  getById(id: string): Connection | undefined {
    const row = this.db.select().from(connections).where(eq(connections.id, id)).get();
    return row ? toConnection(row) : undefined;
  }

  list(): Connection[] {
    return this.db.select().from(connections).all().map(toConnection);
  }

  setStatus(id: string, status: Connection["status"]): void {
    this.db.update(connections).set({ status }).where(eq(connections.id, id)).run();
  }

  update(
    id: string,
    patch: Partial<Pick<Connection, "status" | "toolMeta" | "triggers" | "displayName">>,
  ): void {
    this.db.update(connections).set(patch).where(eq(connections.id, id)).run();
  }

  delete(id: string): void {
    this.db.delete(connections).where(eq(connections.id, id)).run();
  }
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    provider: row.provider as Connection["provider"],
    appId: row.appId,
    displayName: row.displayName,
    status: row.status as Connection["status"],
    toolMeta: row.toolMeta,
    triggers: row.triggers,
    createdAt: row.createdAt.toISOString(),
  };
}
