import type { Approval } from "@openbot/contracts";
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "./db.js";
import { approvals } from "./schema.js";

type ApprovalRow = typeof approvals.$inferSelect;

export class ApprovalsRepo {
  constructor(private readonly db: Db) {}

  create(approval: Approval): void {
    this.db
      .insert(approvals)
      .values({
        id: approval.id,
        kind: approval.kind,
        botId: approval.botId,
        chainId: approval.chainId,
        summary: approval.summary,
        detail: approval.detail,
        risk: approval.risk,
        status: approval.status,
        resolution: approval.resolution,
        expiresAt: new Date(approval.expiresAt),
        createdAt: new Date(approval.createdAt),
      })
      .run();
  }

  getById(id: string): Approval | undefined {
    const row = this.db.select().from(approvals).where(eq(approvals.id, id)).get();
    return row ? toApproval(row) : undefined;
  }

  list(filter: { status?: Approval["status"] } = {}): Approval[] {
    const rows = this.db
      .select()
      .from(approvals)
      .where(filter.status ? eq(approvals.status, filter.status) : undefined)
      .all();
    return rows.map(toApproval);
  }

  resolve(id: string, resolution: "allow" | "deny" | "expired"): void {
    this.db
      .update(approvals)
      .set({ status: "resolved", resolution })
      .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
      .run();
  }

  /** Marks pending approvals past `expiresAt` as expired (E6: "approvals time out after 30 min"). */
  expirePastDue(now: Date): number {
    const result = this.db
      .update(approvals)
      .set({ status: "expired", resolution: "expired" })
      .where(and(eq(approvals.status, "pending"), lt(approvals.expiresAt, now)))
      .run();
    return result.changes;
  }
}

function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    kind: row.kind as Approval["kind"],
    botId: row.botId,
    chainId: row.chainId ?? undefined,
    summary: row.summary,
    detail: row.detail,
    risk: row.risk ?? undefined,
    status: row.status as Approval["status"],
    resolution: row.resolution as Approval["resolution"],
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
