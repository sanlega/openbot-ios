import type {
  ApprovalKind,
  ChainMode,
  Clock,
  DecisionService,
  PermissionPreset,
} from "@openbot/contracts";
import type { ApprovalStore } from "./approval-store.js";
import type { BrokerDecision, BrokerRequest } from "./broker-types.js";
import type { EventSink } from "./event-sink.js";
import {
  builtinAskRules,
  builtinDenyReason,
  presetRules,
  resolveRules,
  ruleReason,
  type RuleStore,
} from "./rules.js";

/** Plan §5 WS2: "Approvals time out after 30 min." */
export const APPROVAL_TIMEOUT_MS = 30 * 60_000;

/** {@link Clock} plus scheduling, needed to expire approvals deterministically under `FakeClock`. */
export interface SchedulingClock extends Clock {
  setTimeout(fn: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

/** Dry-run simulation (plan §5 WS2): these computer ops are read-only and always execute for real, even in a `dry_run` chain. */
const DRY_RUN_READ_ONLY_COMPUTER_OPS = new Set(["observe", "navigate", "scroll"]);

export interface PermissionBrokerOptions {
  ruleStore: RuleStore;
  approvalStore: ApprovalStore;
  events: EventSink;
  decisions: DecisionService;
  clock: SchedulingClock;
  approvalTimeoutMs?: number;
}

/**
 * The permission broker (plan §4.1 E6, §5 WS2). One `evaluate()` call per
 * tool/computer/connector action a Bot's turn wants to take:
 *
 * - **`dry_run` chains**: reads, `sideEffect:false` connector actions, and
 *   `observe`/`navigate`/`scroll` computer ops execute for real; everything
 *   else is recorded as `action.simulated` and never executed
 *   (`outcome: 'simulate'`).
 * - **`live` chains**, in order (E6): built-in deny (never overridable) →
 *   every matching rule (builtin `ask` + preset + user, most severe wins:
 *   `deny > ask > allow`) → the Jev risk gate (auto-allow only when the band
 *   is `auto` **and** the external-side-effect score is low) → a user card
 *   (`ask`).
 */
export class PermissionBroker {
  private readonly pending = new Map<
    string,
    { resolve: (o: "allow" | "deny") => void; timer: number }
  >();

  constructor(private readonly opts: PermissionBrokerOptions) {}

  async evaluate(
    req: BrokerRequest,
    ctx: { mode: ChainMode; preset: PermissionPreset },
  ): Promise<BrokerDecision> {
    if (ctx.mode === "dry_run") return this.evaluateDryRun(req);
    return this.evaluateLive(req, ctx.preset);
  }

  private evaluateDryRun(req: BrokerRequest): BrokerDecision {
    if (req.kind === "tool" && req.readOnly) {
      return { outcome: "allow", reason: "dry run: read-only tool" };
    }
    if (req.kind === "connector_action" && req.sideEffect === false) {
      return { outcome: "allow", reason: "dry run: connector action has no side effect" };
    }
    if (req.kind === "computer_action" && DRY_RUN_READ_ONLY_COMPUTER_OPS.has(req.action)) {
      return { outcome: "allow", reason: "dry run: read-only computer op" };
    }
    this.opts.events.emit({
      ts: this.opts.clock.now().toISOString(),
      type: "action.simulated",
      botId: req.botId,
      chainId: req.chainId,
      payload: { kind: req.kind, action: req.action, target: req.target, args: req.args ?? {} },
    });
    return { outcome: "simulate", reason: "simulated: not executed (dry run)" };
  }

  private async evaluateLive(
    req: BrokerRequest,
    preset: PermissionPreset,
  ): Promise<BrokerDecision> {
    const denyReason = builtinDenyReason(req);
    if (denyReason) return { outcome: "deny", reason: `built-in deny: ${denyReason}` };

    if (req.readOnly) return { outcome: "allow", reason: "read-only action" };

    const rules = [
      ...builtinAskRules(req),
      ...presetRules(preset),
      ...this.opts.ruleStore.list(req.botId),
    ];
    const resolved = resolveRules(rules, req);
    if (resolved) {
      if (resolved.effect === "deny") return { outcome: "deny", reason: ruleReason(resolved.rule) };
      if (resolved.effect === "allow") return this.allowOrAsk(req, ruleReason(resolved.rule));
      return this.ask(req, ruleReason(resolved.rule));
    }

    return this.consultJevRiskGate(req);
  }

  /** An `allow` rule still can't out-rank a *higher-severity* rule matched by a different source — `resolveRules` already picked the most severe, so this is just the terminal allow path. */
  private allowOrAsk(req: BrokerRequest, reason: string): BrokerDecision {
    return { outcome: "allow", reason };
  }

  private async consultJevRiskGate(req: BrokerRequest): Promise<BrokerDecision> {
    const decision = await this.opts.decisions.decide({
      purpose: "risk",
      state: { botId: req.botId, kind: req.kind, action: req.action, target: req.target ?? null },
      questions: {
        external_side_effect: {
          type: "score",
          instructions:
            "How large and how reversible is this action's external side effect, from none to major/irreversible?",
          criteria: ["none", "minor, reversible", "moderate", "major, irreversible"],
        },
      },
    });
    const answer = decision.answers.external_side_effect;
    const confidence = answer && "confidence" in answer ? answer.confidence : undefined;
    const band = confidence !== undefined ? this.opts.decisions.band(confidence, "risk") : "human";
    // 4 ordered levels (none..major), normalized to 0..1; "none"/"minor" (score 0-1) count as low.
    const sideEffect = answer?.type === "score" ? answer.score / 3 : 1;
    if (band === "auto" && sideEffect < 0.2) {
      return {
        outcome: "allow",
        reason: `Jev risk gate: band=auto, external_side_effect=${sideEffect.toFixed(2)}`,
      };
    }
    return this.ask(
      req,
      `Jev risk gate: band=${band}, external_side_effect=${sideEffect.toFixed(2)}`,
    );
  }

  private ask(req: BrokerRequest, reason: string): BrokerDecision {
    const expiresAt = new Date(
      this.opts.clock.now().getTime() + (this.opts.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS),
    ).toISOString();
    const approval = this.opts.approvalStore.create({
      kind: brokerKindToApprovalKind(req.kind),
      botId: req.botId,
      chainId: req.chainId,
      summary: req.summary,
      detail: `${req.detail}\n\n${reason}`,
      expiresAt,
    });
    this.opts.events.emit({
      ts: this.opts.clock.now().toISOString(),
      type: "approval.requested",
      botId: req.botId,
      chainId: req.chainId,
      payload: { approvalId: approval.id, kind: approval.kind, summary: approval.summary, reason },
    });
    return { outcome: "ask", reason, approvalId: approval.id };
  }

  /**
   * Resolves once the approval identified by `approvalId` is resolved by
   * {@link resolveApproval}, or times out (30 min default, plan §5 WS2) and
   * resolves to `"deny"`.
   */
  waitForApproval(approvalId: string): Promise<"allow" | "deny"> {
    const approval = this.opts.approvalStore.get(approvalId);
    if (!approval) throw new Error(`PermissionBroker: unknown approval ${approvalId}`);
    if (approval.status !== "pending") {
      return Promise.resolve(approval.resolution === "allow" ? "allow" : "deny");
    }
    return new Promise((resolvePromise) => {
      const timeoutMs = Math.max(
        0,
        new Date(approval.expiresAt).getTime() - this.opts.clock.now().getTime(),
      );
      const timer = this.opts.clock.setTimeout(() => {
        this.pending.delete(approvalId);
        this.opts.approvalStore.resolve(approvalId, "expired");
        this.emitResolved(approvalId, "expired");
        resolvePromise("deny");
      }, timeoutMs);
      this.pending.set(approvalId, { resolve: resolvePromise, timer });
    });
  }

  /** A user (or CoS) resolving a pending approval card. */
  resolveApproval(approvalId: string, resolution: "allow" | "deny"): void {
    this.opts.approvalStore.resolve(approvalId, resolution);
    this.emitResolved(approvalId, resolution);
    const pending = this.pending.get(approvalId);
    if (pending) {
      this.opts.clock.clearTimeout(pending.timer);
      this.pending.delete(approvalId);
      pending.resolve(resolution);
    }
  }

  /**
   * Wakes whoever awaits {@link waitForApproval} for a card another component
   * already resolved and recorded (the Client API updates the store and emits
   * `approval.resolved` itself), without writing or emitting again.
   */
  settleResolved(approvalId: string, resolution: "allow" | "deny"): void {
    const pending = this.pending.get(approvalId);
    if (!pending) return;
    this.opts.clock.clearTimeout(pending.timer);
    this.pending.delete(approvalId);
    pending.resolve(resolution);
  }

  private emitResolved(approvalId: string, resolution: "allow" | "deny" | "expired"): void {
    this.opts.events.emit({
      ts: this.opts.clock.now().toISOString(),
      type: "approval.resolved",
      payload: { approvalId, resolution },
    });
  }
}

function brokerKindToApprovalKind(kind: BrokerRequest["kind"]): ApprovalKind {
  switch (kind) {
    case "tool":
      return "tool";
    case "computer_action":
      return "computer_action";
    case "connector_action":
      return "connector_action";
    case "local_computer":
      return "local_computer";
  }
}
