import { FakeClock } from "@openbot/testkit";
import { describe, expect, it } from "vitest";
import { ChainManager, DEFAULT_CHAIN_LIMITS, InMemoryChainStore } from "./chain.js";
import { DeliveryService } from "./delivery.js";
import { InMemoryEventSink } from "./event-sink.js";
import { LoopGuards } from "./guards.js";
import { InMemoryMessageStore } from "./message-store.js";
import {
  PassthroughNotifyGate,
  type NotifyGate,
  type NotifyRequest,
  type NotifyResult,
} from "./notify-gate.js";

class StubDecisionService {
  async decide() {
    return {
      answers: { likely_loop: { type: "noul" as const, noul: 0.5 } },
      provider: "heuristic" as const,
      model: "stub",
      latencyMs: 0,
      decisionId: "dec_stub",
    };
  }
  band() {
    return "human" as const;
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

class RecordingNotifyGate implements NotifyGate {
  readonly requests: NotifyRequest[] = [];
  result: NotifyResult = { delivery: "delivered", pushed: false };
  async notify(req: NotifyRequest): Promise<NotifyResult> {
    this.requests.push(req);
    return this.result;
  }
}

function setup(
  chainMode: "live" | "dry_run" = "live",
  notify: NotifyGate = new PassthroughNotifyGate(),
) {
  const events = new InMemoryEventSink();
  const clock = new FakeClock(0);
  const chains = new ChainManager(new InMemoryChainStore(), events, clock, DEFAULT_CHAIN_LIMITS);
  const chain = chains.create({ origin: "bot", mode: chainMode });
  const guards = new LoopGuards({ events, chains, clock, decisions: new StubDecisionService() });
  const messages = new InMemoryMessageStore(() => clock.now().toISOString());
  const delivery = new DeliveryService({ messages, chains, guards, events, notify, clock });
  return { events, clock, chains, chain, delivery, messages };
}

describe("DeliveryService.sendBotToBot", () => {
  it("delivers a message and increments hop/botMessages in a live chain", async () => {
    const { delivery, chain, messages, events } = setup("live");
    const result = await delivery.sendBotToBot({
      chainId: chain.id,
      fromBotId: "bot_a",
      toBotId: "bot_b",
      toThreadId: "thr_b",
      text: "please handle this",
      mode: "live",
    });
    expect(result.outcome).toBe("delivered");
    expect(result.message?.hop).toBe(1);
    expect(messages.list("thr_b")).toHaveLength(1);
    expect(events.byType("handoff.sent")).toHaveLength(1);
  });

  it("simulates in a dry_run chain: no Message row, no hop increment side effect, but botMessages/action.simulated still recorded", async () => {
    const { delivery, chain, messages, events, chains } = setup("dry_run");
    const result = await delivery.sendBotToBot({
      chainId: chain.id,
      fromBotId: "bot_a",
      toBotId: "bot_b",
      toThreadId: "thr_b",
      text: "please handle this",
      mode: "dry_run",
    });
    expect(result.outcome).toBe("simulated");
    expect(messages.list("thr_b")).toHaveLength(0);
    expect(events.byType("action.simulated")).toHaveLength(1);
    expect(events.byType("handoff.sent")).toHaveLength(0);
    expect(chains.get(chain.id).botMessages).toBe(1);
  });

  it("refuses once maxHops would be exceeded, and pauses the chain", async () => {
    const events = new InMemoryEventSink();
    const clock = new FakeClock(0);
    const chains = new ChainManager(new InMemoryChainStore(), events, clock, {
      ...DEFAULT_CHAIN_LIMITS,
      maxHops: 1,
    });
    const chain = chains.create({ origin: "bot", mode: "live" });
    const guards = new LoopGuards({ events, chains, clock, decisions: new StubDecisionService() });
    const messages = new InMemoryMessageStore(() => clock.now().toISOString());
    const delivery = new DeliveryService({
      messages,
      chains,
      guards,
      events,
      notify: new PassthroughNotifyGate(),
      clock,
    });

    const first = await delivery.sendBotToBot({
      chainId: chain.id,
      fromBotId: "a",
      toBotId: "b",
      toThreadId: "thr_b",
      text: "hop 1",
      mode: "live",
    });
    expect(first.outcome).toBe("delivered");

    const second = await delivery.sendBotToBot({
      chainId: chain.id,
      fromBotId: "b",
      toBotId: "c",
      toThreadId: "thr_c",
      text: "hop 2",
      mode: "live",
    });
    expect(second.outcome).toBe("refused");
    expect(second.reason).toMatch(/max hops/);
    expect(chains.isActive(chain.id)).toBe(false);
  });

  it("refuses when a loop guard trips (e.g. bot-pair rate limit)", async () => {
    const events = new InMemoryEventSink();
    const clock = new FakeClock(0);
    const chains = new ChainManager(new InMemoryChainStore(), events, clock, DEFAULT_CHAIN_LIMITS);
    const chain = chains.create({ origin: "bot", mode: "live" });
    const guards = new LoopGuards({
      events,
      chains,
      clock,
      decisions: new StubDecisionService(),
      maxMessagesPerPairPerWindow: 1,
    });
    const messages = new InMemoryMessageStore(() => clock.now().toISOString());
    const delivery = new DeliveryService({
      messages,
      chains,
      guards,
      events,
      notify: new PassthroughNotifyGate(),
      clock,
    });
    await delivery.sendBotToBot({
      chainId: chain.id,
      fromBotId: "a",
      toBotId: "b",
      toThreadId: "thr_b",
      text: "1",
      mode: "live",
    });
    const second = await delivery.sendBotToBot({
      chainId: chain.id,
      fromBotId: "a",
      toBotId: "b",
      toThreadId: "thr_b",
      text: "2",
      mode: "live",
    });
    expect(second.outcome).toBe("refused");
    expect(second.guard?.tripped).toBe(true);
  });

  it("refuses when the chain is not active", async () => {
    const { delivery, chain, chains } = setup("live");
    chains.stop(chain.id);
    const result = await delivery.sendBotToBot({
      chainId: chain.id,
      fromBotId: "a",
      toBotId: "b",
      toThreadId: "thr_b",
      text: "hello",
      mode: "live",
    });
    expect(result.outcome).toBe("refused");
  });
});

describe("DeliveryService.sendBotToUser (never sends directly — always via NotifyGate)", () => {
  it("calls the NotifyGate and creates a Message reflecting its delivery status", async () => {
    const notify = new RecordingNotifyGate();
    notify.result = { delivery: "delivered", pushed: true, notifyDecisionId: "dec_1" };
    const { delivery, chain, messages } = setup("live", notify);
    const result = await delivery.sendBotToUser({
      chainId: chain.id,
      botId: "bot_a",
      threadId: "thr_a",
      kind: "result",
      text: "all done",
      mode: "live",
    });
    expect(result.outcome).toBe("delivered");
    expect(notify.requests).toHaveLength(1);
    expect(messages.list("thr_a")[0]?.delivery).toBe("delivered");
  });

  it("reflects a 'held' NotifyGate decision on the created Message", async () => {
    const notify = new RecordingNotifyGate();
    notify.result = { delivery: "held", pushed: false };
    const { delivery, chain, messages, events } = setup("live", notify);
    await delivery.sendBotToUser({
      chainId: chain.id,
      botId: "bot_a",
      threadId: "thr_a",
      kind: "decision",
      text: "pick one",
      mode: "live",
    });
    expect(messages.list("thr_a")[0]?.delivery).toBe("held");
    expect(events.byType("message.held")).toHaveLength(1);
  });

  it("in a dry_run chain, never calls the NotifyGate and never creates a Message", async () => {
    const notify = new RecordingNotifyGate();
    const { delivery, chain, messages, events } = setup("dry_run", notify);
    const result = await delivery.sendBotToUser({
      chainId: chain.id,
      botId: "bot_a",
      threadId: "thr_a",
      kind: "blocker",
      text: "need your card",
      mode: "dry_run",
    });
    expect(result.outcome).toBe("simulated");
    expect(notify.requests).toHaveLength(0);
    expect(messages.list("thr_a")).toHaveLength(0);
    expect(events.byType("action.simulated")).toHaveLength(1);
  });
});
