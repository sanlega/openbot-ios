import type {
  Action,
  DecideRequest,
  DecideResult,
  DecisionService,
  Screen,
} from "@openbot/contracts";
import { FakeComputerProvider } from "@openbot/computer-fake";
import { FakeClock } from "@openbot/testkit";
import { describe, expect, it, vi } from "vitest";
import { InMemoryApprovalStore } from "./approval-store.js";
import type { BrokerRequest } from "./broker-types.js";
import { PermissionBroker } from "./broker.js";
import { InMemoryEventSink } from "./event-sink.js";
import { InMemoryRuleStore } from "./rules.js";

/** Never called for these tests — the risk gate must never even be consulted for the read-only ops below, and the sensitive-click case resolves via a built-in `ask` rule before reaching it. */
class UnusedDecisionService implements DecisionService {
  async decide(_req: DecideRequest): Promise<DecideResult> {
    throw new Error("PermissionBroker should not have consulted the Jev risk gate in this test");
  }
  band() {
    return "auto" as const;
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
}

/**
 * How a real computer-action executor (WS9's fast loop) is expected to
 * integrate with the broker: gate every `act()`/`observe()` call behind
 * `broker.evaluate()` first, and only touch the real `Screen` when the
 * outcome is `allow`. This mirrors that contract so the test can prove the
 * broker's dry-run gate is what's preventing execution, not a fake that
 * happens not to be wired up.
 */
async function attemptComputerAction(
  broker: PermissionBroker,
  screen: Screen,
  req: BrokerRequest,
  action: Action,
): Promise<"executed" | "simulated" | "denied" | "asked"> {
  const decision = await broker.evaluate(req, { mode: "dry_run", preset: "full" });
  if (decision.outcome === "allow") {
    await screen.act(action);
    return "executed";
  }
  if (decision.outcome === "simulate") return "simulated";
  return decision.outcome === "deny" ? "denied" : "asked";
}

describe("Dry-run leak test (plan §5 WS2 acceptance): a dry-run chain trying to write/send/click produces zero side effects, every attempt logged as action.simulated", () => {
  it("navigate/scroll execute for real against the FakeComputerProvider; click does not, and is recorded as action.simulated", async () => {
    const events = new InMemoryEventSink();
    const clock = new FakeClock(0);
    const broker = new PermissionBroker({
      ruleStore: new InMemoryRuleStore(),
      approvalStore: new InMemoryApprovalStore(clock),
      events,
      decisions: new UnusedDecisionService(),
      clock,
    });

    const computer = new FakeComputerProvider();
    await computer.ensureStarted();
    const screen = await computer.screen("bot_a");
    const actSpy = vi.spyOn(screen, "act");

    // navigate: dry-run always executes read-only computer ops for real.
    const navigateOutcome = await attemptComputerAction(
      broker,
      screen,
      {
        botId: "bot_a",
        chainId: "chn_a",
        kind: "computer_action",
        action: "navigate",
        summary: "go to compose",
        detail: "navigate to compose",
      },
      { op: "navigate", url: "https://fake.local/compose" },
    );
    expect(navigateOutcome).toBe("executed");
    expect(actSpy).toHaveBeenCalledTimes(1);

    // click "Send": a side-effecting op AND a sensitive target — must be
    // simulated, never actually clicked, regardless of preset.
    const observation = await screen.observe();
    const sendButton = observation.elements.find((e) => e.label === "Send");
    expect(sendButton).toBeDefined();

    const clickOutcome = await attemptComputerAction(
      broker,
      screen,
      {
        botId: "bot_a",
        chainId: "chn_a",
        kind: "computer_action",
        action: "click",
        target: sendButton!.label,
        summary: "click Send",
        detail: "click the Send button",
      },
      { op: "click", target: sendButton!.index },
    );
    expect(clickOutcome).toBe("simulated");
    // Still only the one earlier `navigate` call — the click never reached `act()`.
    expect(actSpy).toHaveBeenCalledTimes(1);

    const simulated = events.byType("action.simulated");
    expect(simulated).toHaveLength(1);
    expect(simulated[0]?.payload).toMatchObject({
      kind: "computer_action",
      action: "click",
      target: "Send",
    });

    // The page itself never actually advanced past compose (a real "Send"
    // click would have navigated to the "sent" fixture page) — the clearest
    // possible proof, from the fake computer's own state, that nothing leaked.
    const stillOnCompose = await screen.observe();
    expect(stillOnCompose.title).toBe("New message");
  });

  it("a write-ish tool is simulated in dry-run and never reaches an outcome other than 'simulate'", async () => {
    const events = new InMemoryEventSink();
    const clock = new FakeClock(0);
    const broker = new PermissionBroker({
      ruleStore: new InMemoryRuleStore(),
      approvalStore: new InMemoryApprovalStore(clock),
      events,
      decisions: new UnusedDecisionService(),
      clock,
    });

    const decision = await broker.evaluate(
      {
        botId: "bot_a",
        chainId: "chn_a",
        kind: "tool",
        action: "write_file",
        target: "notes.txt",
        readOnly: false,
        summary: "write notes.txt",
        detail: "write notes.txt",
      },
      { mode: "dry_run", preset: "full" },
    );
    expect(decision.outcome).toBe("simulate");
    expect(events.byType("action.simulated")).toHaveLength(1);
  });
});
