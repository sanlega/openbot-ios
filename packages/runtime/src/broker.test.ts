import type {
  Band,
  DecideRequest,
  DecideResult,
  DecisionService,
  Purpose,
} from "@openbot/contracts";
import { bandConfidence } from "@openbot/contracts";
import { FakeClock } from "@openbot/testkit";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryApprovalStore } from "./approval-store.js";
import type { BrokerRequest } from "./broker-types.js";
import { APPROVAL_TIMEOUT_MS, PermissionBroker } from "./broker.js";
import { InMemoryEventSink } from "./event-sink.js";
import { InMemoryRuleStore } from "./rules.js";

/** A `DecisionService` stub whose `risk`-purpose score/confidence are fixed per test, so the Jev risk gate's auto-allow condition (`band === 'auto' && sideEffect < 0.2`) can be exercised in both directions deterministically. */
class StubRiskDecisionService implements DecisionService {
  constructor(
    private readonly score: number,
    private readonly confidence: number,
  ) {}
  async decide(_req: DecideRequest): Promise<DecideResult> {
    return {
      answers: {
        external_side_effect: {
          type: "score",
          score: this.score,
          confidence: this.confidence,
          legend: { "0": "none", "1": "minor", "2": "moderate", "3": "major" },
          probabilities: {},
        },
      },
      provider: "heuristic",
      model: "stub",
      latencyMs: 0,
      decisionId: "dec_stub",
    };
  }
  band(confidence: number, _purpose: Purpose): Band {
    return bandConfidence(confidence);
  }
  budgets() {
    return {
      gates: { limitRpm: 60, usedRpm: 0, queued: 0 },
      interactive: { limitRpm: 60, usedRpm: 0, queued: 0 },
      computer: { limitRpm: 60, usedRpm: 0, queued: 0 },
      background: { limitRpm: 60, usedRpm: 0, queued: 0 },
    };
  }
  async validateKey() {
    return { ok: true };
  }
  async route() {
    return {
      engine: "fake" as const,
      model: "fake-default",
      band: "auto" as const,
      decisionId: "dec_route",
    };
  }
}

function req(overrides: Partial<BrokerRequest> = {}): BrokerRequest {
  return {
    botId: "bot_a",
    chainId: "chn_a",
    kind: "tool",
    action: "write_file",
    summary: "write a file",
    detail: "write a file",
    ...overrides,
  };
}

function setup(decisions: DecisionService) {
  const events = new InMemoryEventSink();
  const clock = new FakeClock(0);
  const ruleStore = new InMemoryRuleStore();
  const approvalStore = new InMemoryApprovalStore(clock);
  const broker = new PermissionBroker({ ruleStore, approvalStore, events, decisions, clock });
  return { events, clock, ruleStore, approvalStore, broker };
}

describe("PermissionBroker dry-run simulation (chain.mode = 'dry_run')", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup(new StubRiskDecisionService(0, 0.95));
  });

  it("executes read-only tools for real", async () => {
    const decision = await ctx.broker.evaluate(req({ readOnly: true }), {
      mode: "dry_run",
      preset: "full",
    });
    expect(decision.outcome).toBe("allow");
  });

  it("executes sideEffect:false connector actions for real", async () => {
    const decision = await ctx.broker.evaluate(
      req({ kind: "connector_action", action: "list_emails", sideEffect: false }),
      { mode: "dry_run", preset: "full" },
    );
    expect(decision.outcome).toBe("allow");
  });

  it.each(["observe", "navigate", "scroll"])("executes computer op %s for real", async (action) => {
    const decision = await ctx.broker.evaluate(req({ kind: "computer_action", action }), {
      mode: "dry_run",
      preset: "full",
    });
    expect(decision.outcome).toBe("allow");
  });

  it("simulates a write tool and records action.simulated, never executing it", async () => {
    const decision = await ctx.broker.evaluate(req({ action: "write_file", readOnly: false }), {
      mode: "dry_run",
      preset: "full",
    });
    expect(decision.outcome).toBe("simulate");
    expect(ctx.events.byType("action.simulated")).toHaveLength(1);
  });

  it.each(["click", "type"])("simulates computer op %s, never executing it", async (action) => {
    const decision = await ctx.broker.evaluate(
      req({ kind: "computer_action", action, target: "Pay now" }),
      { mode: "dry_run", preset: "full" },
    );
    expect(decision.outcome).toBe("simulate");
  });

  it("simulates a sideEffect connector action", async () => {
    const decision = await ctx.broker.evaluate(
      req({ kind: "connector_action", action: "send_email", sideEffect: true }),
      { mode: "dry_run", preset: "full" },
    );
    expect(decision.outcome).toBe("simulate");
  });
});

describe("PermissionBroker live evaluation, E6 order", () => {
  it("built-in deny always wins, even under the 'full' preset", async () => {
    const { broker } = setup(new StubRiskDecisionService(0, 0.99));
    const decision = await broker.evaluate(req({ action: "read_file", target: ".ssh/id_rsa" }), {
      mode: "live",
      preset: "full",
    });
    expect(decision.outcome).toBe("deny");
    expect(decision.reason).toMatch(/built-in deny/);
  });

  it("read-only actions are allowed upstream of any rule/gate", async () => {
    const { broker } = setup(new StubRiskDecisionService(3, 0.99));
    const decision = await broker.evaluate(req({ action: "read_file", readOnly: true }), {
      mode: "live",
      preset: "read_only",
    });
    expect(decision.outcome).toBe("allow");
  });

  it("a sensitive computer target (e.g. clicking 'Pay'/'Send') always raises a card, even under 'full'", async () => {
    const { broker } = setup(new StubRiskDecisionService(0, 0.99));
    const decision = await broker.evaluate(
      req({ kind: "computer_action", action: "click", target: "Send" }),
      { mode: "live", preset: "full" },
    );
    expect(decision.outcome).toBe("ask");
    expect(decision.approvalId).toBeDefined();
  });

  it("a user-authored deny rule beats a user-authored always-allow rule for the same tool", async () => {
    const { broker, ruleStore } = setup(new StubRiskDecisionService(0, 0.99));
    ruleStore.add({
      scope: "bot_a",
      match: { tool: "risky_tool" },
      effect: "allow",
      source: "user",
    });
    ruleStore.add({
      scope: "bot_a",
      match: { tool: "risky_tool" },
      effect: "deny",
      source: "user",
    });
    const decision = await broker.evaluate(req({ action: "risky_tool" }), {
      mode: "live",
      preset: "full",
    });
    expect(decision.outcome).toBe("deny");
  });

  it("read_only preset denies a non-read action via its blanket rule", async () => {
    const { broker } = setup(new StubRiskDecisionService(0, 0.99));
    const decision = await broker.evaluate(req({ action: "write_file" }), {
      mode: "live",
      preset: "read_only",
    });
    expect(decision.outcome).toBe("deny");
  });

  it("falls through to the Jev risk gate when no rule matches, auto-allowing low-risk actions in the auto band", async () => {
    const { broker, events } = setup(new StubRiskDecisionService(0, 0.95));
    const decision = await broker.evaluate(req({ action: "harmless_tool" }), {
      mode: "live",
      preset: "full",
    });
    expect(decision.outcome).toBe("allow");
    expect(decision.reason).toMatch(/Jev risk gate/);
    expect(events.byType("approval.requested")).toHaveLength(0);
  });

  it("asks (raises a card) when the Jev risk gate's band is not auto, even for a low score", async () => {
    const { broker } = setup(new StubRiskDecisionService(0, 0.6));
    const decision = await broker.evaluate(req({ action: "harmless_tool" }), {
      mode: "live",
      preset: "full",
    });
    expect(decision.outcome).toBe("ask");
  });

  it("asks when the Jev risk gate's band is auto but the side effect score is not low", async () => {
    const { broker } = setup(new StubRiskDecisionService(3, 0.95));
    const decision = await broker.evaluate(req({ action: "risky_tool" }), {
      mode: "live",
      preset: "full",
    });
    expect(decision.outcome).toBe("ask");
  });
});

describe("PermissionBroker approvals (30 min timeout, resolve)", () => {
  it("waitForApproval resolves 'allow' once a user resolves the approval", async () => {
    const { broker } = setup(new StubRiskDecisionService(3, 0.6));
    const decision = await broker.evaluate(req({ action: "risky_tool" }), {
      mode: "live",
      preset: "full",
    });
    expect(decision.outcome).toBe("ask");
    const pending = broker.waitForApproval(decision.approvalId as string);
    broker.resolveApproval(decision.approvalId as string, "allow");
    expect(await pending).toBe("allow");
  });

  it("waitForApproval resolves 'deny' once a user resolves the approval as deny", async () => {
    const { broker } = setup(new StubRiskDecisionService(3, 0.6));
    const decision = await broker.evaluate(req({ action: "risky_tool" }), {
      mode: "live",
      preset: "full",
    });
    const pending = broker.waitForApproval(decision.approvalId as string);
    broker.resolveApproval(decision.approvalId as string, "deny");
    expect(await pending).toBe("deny");
  });

  it("approvals time out after 30 minutes and resolve to 'deny'", async () => {
    const { broker, clock, approvalStore } = setup(new StubRiskDecisionService(3, 0.6));
    const decision = await broker.evaluate(req({ action: "risky_tool" }), {
      mode: "live",
      preset: "full",
    });
    const pending = broker.waitForApproval(decision.approvalId as string);
    clock.advance(APPROVAL_TIMEOUT_MS);
    expect(await pending).toBe("deny");
    expect(approvalStore.get(decision.approvalId as string)?.status).toBe("expired");
  });

  it("resolves immediately (without a new timer) when waitForApproval is called on an already-resolved approval", async () => {
    const { broker } = setup(new StubRiskDecisionService(3, 0.6));
    const decision = await broker.evaluate(req({ action: "risky_tool" }), {
      mode: "live",
      preset: "full",
    });
    broker.resolveApproval(decision.approvalId as string, "allow");
    expect(await broker.waitForApproval(decision.approvalId as string)).toBe("allow");
  });
});
