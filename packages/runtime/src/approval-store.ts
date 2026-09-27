import { newId, type Approval, type ApprovalKind } from "@openbot/contracts";
import type { Clock } from "@openbot/contracts";

/** Plan §4.1 `Approval`. WS1 will back this port with `@openbot/store`'s `approvals` table; this in-memory adapter is enough for WS2's own scenario tests. */
export interface ApprovalStore {
  create(input: {
    kind: ApprovalKind;
    botId: string;
    chainId?: string;
    summary: string;
    detail: string;
    risk?: number;
    expiresAt: string;
  }): Approval;
  get(id: string): Approval | undefined;
  resolve(id: string, resolution: "allow" | "deny" | "expired"): Approval;
  listPending(): Approval[];
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly approvals = new Map<string, Approval>();

  constructor(private readonly clock: Clock = { now: () => new Date() }) {}

  create(input: {
    kind: ApprovalKind;
    botId: string;
    chainId?: string;
    summary: string;
    detail: string;
    risk?: number;
    expiresAt: string;
  }): Approval {
    const approval: Approval = {
      id: newId("approval"),
      kind: input.kind,
      botId: input.botId,
      chainId: input.chainId,
      summary: input.summary,
      detail: input.detail,
      risk: input.risk,
      status: "pending",
      resolution: undefined,
      expiresAt: input.expiresAt,
      createdAt: this.clock.now().toISOString(),
    };
    this.approvals.set(approval.id, approval);
    return approval;
  }

  get(id: string): Approval | undefined {
    return this.approvals.get(id);
  }

  resolve(id: string, resolution: "allow" | "deny" | "expired"): Approval {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error(`ApprovalStore: unknown approval ${id}`);
    const resolved: Approval = {
      ...approval,
      status: resolution === "expired" ? "expired" : "resolved",
      resolution,
    };
    this.approvals.set(id, resolved);
    return resolved;
  }

  listPending(): Approval[] {
    return [...this.approvals.values()].filter((a) => a.status === "pending");
  }

  /** Marks every pending approval whose `expiresAt` is at or before `now` as `expired` (plan §5 WS2: "Approvals time out after 30 min"). Returns the ones just expired. */
  expireDue(now: Date): Approval[] {
    const expired: Approval[] = [];
    for (const approval of this.listPending()) {
      if (new Date(approval.expiresAt).getTime() <= now.getTime()) {
        expired.push(this.resolve(approval.id, "expired"));
      }
    }
    return expired;
  }
}
