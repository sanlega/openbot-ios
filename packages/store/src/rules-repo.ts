import type { Rule } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { rules } from "./schema.js";

type RuleRow = typeof rules.$inferSelect;

/** Permission-broker rules (plan §4.1, WS2 evaluates precedence; this is storage only). */
export class RulesRepo {
  constructor(private readonly db: Db) {}

  create(rule: Rule): void {
    this.db
      .insert(rules)
      .values({
        id: rule.id,
        scope: rule.scope,
        match: rule.match,
        effect: rule.effect,
        source: rule.source,
        createdAt: new Date(rule.createdAt),
      })
      .run();
  }

  getById(id: string): Rule | undefined {
    const row = this.db.select().from(rules).where(eq(rules.id, id)).get();
    return row ? toRule(row) : undefined;
  }

  list(): Rule[] {
    return this.db.select().from(rules).all().map(toRule);
  }

  delete(id: string): void {
    this.db.delete(rules).where(eq(rules.id, id)).run();
  }
}

function toRule(row: RuleRow): Rule {
  return {
    id: row.id,
    scope: row.scope,
    match: row.match as Rule["match"],
    effect: row.effect as Rule["effect"],
    source: row.source as Rule["source"],
    createdAt: row.createdAt.toISOString(),
  };
}
