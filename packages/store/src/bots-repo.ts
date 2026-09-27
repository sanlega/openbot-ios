import type { Bot } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { bots } from "./schema.js";

type BotRow = typeof bots.$inferSelect;

/**
 * Minimal repository proving the schema round-trips real `@openbot/contracts`
 * shapes end to end. Full CRUD (duplicate, archive, roster queries, etc.) is
 * WS1's `packages/core` scope — this is just enough for WS0's conformance tests.
 */
export class BotsRepo {
  constructor(private readonly db: Db) {}

  create(bot: Bot): void {
    this.db
      .insert(bots)
      .values({
        id: bot.id,
        slug: bot.slug,
        name: bot.name,
        label: bot.label,
        description: bot.description,
        avatar: bot.avatar,
        pinned: bot.pinned,
        hidden: bot.hidden,
        isChiefOfStaff: bot.isChiefOfStaff,
        createdBy: bot.createdBy,
        lastActiveAt: bot.lastActiveAt ? new Date(bot.lastActiveAt) : undefined,
        archivedAt: bot.archivedAt ? new Date(bot.archivedAt) : undefined,
        routing: bot.routing,
        auth: bot.auth,
        permissionPreset: bot.permissionPreset,
        computer: bot.computer,
        connectors: bot.connectors,
        dailyUsd: bot.limits.dailyUsd,
        dailyTokens: bot.limits.dailyTokens,
        justification: bot.justification,
        createdAt: new Date(),
      })
      .run();
  }

  getById(id: string): Bot | undefined {
    const row = this.db.select().from(bots).where(eq(bots.id, id)).get();
    return row ? toBot(row) : undefined;
  }

  list(): Bot[] {
    return this.db.select().from(bots).all().map(toBot);
  }
}

function toBot(row: BotRow): Bot {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    label: row.label ?? undefined,
    description: row.description,
    avatar: row.avatar ?? undefined,
    pinned: row.pinned,
    hidden: row.hidden,
    isChiefOfStaff: row.isChiefOfStaff,
    createdBy: row.createdBy as Bot["createdBy"],
    lastActiveAt: row.lastActiveAt?.toISOString(),
    archivedAt: row.archivedAt?.toISOString(),
    routing: row.routing,
    auth: row.auth ?? undefined,
    permissionPreset: row.permissionPreset as Bot["permissionPreset"],
    computer: row.computer as Bot["computer"],
    connectors: row.connectors,
    limits: { dailyUsd: row.dailyUsd ?? undefined, dailyTokens: row.dailyTokens ?? undefined },
    justification: row.justification ?? undefined,
  };
}
