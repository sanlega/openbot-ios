import type {
  Band,
  DecideRequest,
  DecideResult,
  DecisionService,
  Purpose,
} from "@openbot/contracts";
import { FakeClock } from "@openbot/testkit";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { ChainManager, DEFAULT_CHAIN_LIMITS, InMemoryChainStore } from "./chain.js";
import { InMemoryEventSink } from "./event-sink.js";
import { LoopGuards } from "./guards.js";

/** A `DecisionService` stub whose `loop`-purpose answer (and band) are set per test, so the Jev loop gate's own trip condition can be exercised deterministically without depending on `FakeDecisionService`'s fixed heuristic. */
class StubDecisionService implements DecisionService {
  constructor(private readonly noul: number) {}
  async decide(_req: DecideRequest): Promise<DecideResult> {
    return {
      answers: { likely_loop: { type: "noul", noul: this.noul } },
      provider: "heuristic",
      model: "stub",
      latencyMs: 0,
      decisionId: "dec_stub",
    };
  }
  band(_confidence: number, _purpose: Purpose): Band {
    return "human";
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

function setup(
  options: {
    decisions?: DecisionService;
    maxMessagesPerPairPerWindow?: number;
    maxRepeatedContent?: number;
  } = {},
) {
  const events = new InMemoryEventSink();
  const clock = new FakeClock(0);
  const chains = new ChainManager(new InMemoryChainStore(), events, clock, DEFAULT_CHAIN_LIMITS);
  const chain = chains.create({ origin: "bot", mode: "live" });
  const guards = new LoopGuards({
    events,
    chains,
    clock,
    decisions: options.decisions ?? new StubDecisionService(0.5),
    maxMessagesPerPairPerWindow: options.maxMessagesPerPairPerWindow,
    maxRepeatedContent: options.maxRepeatedContent,
  });
  return { events, clock, chains, chain, guards };
}

describe("LoopGuards (plan §5 WS2 loop protection, acceptance: looping fake Bots get paused)", () => {
  it("trips the bot-pair rate limit and pauses the chain", async () => {
    const { guards, chains, chain } = setup({
      maxMessagesPerPairPerWindow: 3,
      maxRepeatedContent: 1000,
    });
    for (let i = 0; i < 3; i++) {
      const result = await guards.check({
        chainId: chain.id,
        fromBotId: "a",
        toBotId: "b",
        text: `msg ${i}`,
      });
      expect(result.tripped).toBe(false);
    }
    const result = await guards.check({
      chainId: chain.id,
      fromBotId: "a",
      toBotId: "b",
      text: "msg 3",
    });
    expect(result.tripped).toBe(true);
    expect(result.reason).toMatch(/rate limit/);
    expect(chains.isActive(chain.id)).toBe(false);
  });

  it("trips repeated-content detection and pauses the chain", async () => {
    const { guards, chains, chain } = setup({
      maxMessagesPerPairPerWindow: 1000,
      maxRepeatedContent: 3,
    });
    for (let i = 0; i < 2; i++) {
      const result = await guards.check({
        chainId: chain.id,
        fromBotId: "a",
        toBotId: "b",
        text: "same message",
      });
      expect(result.tripped).toBe(false);
    }
    const result = await guards.check({
      chainId: chain.id,
      fromBotId: "a",
      toBotId: "b",
      text: "same message",
    });
    expect(result.tripped).toBe(true);
    expect(result.reason).toMatch(/repeated content/);
    expect(chains.isActive(chain.id)).toBe(false);
  });

  it("does not trip repeated-content detection when messages vary", async () => {
    const { guards, chain } = setup({ maxMessagesPerPairPerWindow: 1000, maxRepeatedContent: 3 });
    for (let i = 0; i < 10; i++) {
      const result = await guards.check({
        chainId: chain.id,
        fromBotId: "a",
        toBotId: "b",
        text: `unique ${i}`,
      });
      expect(result.tripped).toBe(false);
    }
  });

  it("trips the Jev loop gate when it reports a likely loop in the human band", async () => {
    const { guards, chains, chain } = setup({
      maxMessagesPerPairPerWindow: 1000,
      maxRepeatedContent: 1000,
      decisions: new StubDecisionService(0.6),
    });
    const result = await guards.check({
      chainId: chain.id,
      fromBotId: "a",
      toBotId: "b",
      text: "hello",
    });
    expect(result.tripped).toBe(true);
    expect(result.reason).toMatch(/Jev loop gate/);
    expect(chains.isActive(chain.id)).toBe(false);
  });

  it("does not trip the Jev loop gate when noul is at/below the undecided midpoint", async () => {
    const { guards } = setup({
      maxMessagesPerPairPerWindow: 1000,
      maxRepeatedContent: 1000,
      decisions: new StubDecisionService(0.5),
    });
    const result = await guards.check({
      chainId: "chn_x",
      fromBotId: "a",
      toBotId: "b",
      text: "hello",
    });
    expect(result.tripped).toBe(false);
  });

  it("tracks rate limits per (chain, ordered pair) independently", async () => {
    const { guards, chain } = setup({ maxMessagesPerPairPerWindow: 1, maxRepeatedContent: 1000 });
    const aToB1 = await guards.check({
      chainId: chain.id,
      fromBotId: "a",
      toBotId: "b",
      text: "x",
    });
    const bToA1 = await guards.check({
      chainId: chain.id,
      fromBotId: "b",
      toBotId: "a",
      text: "x",
    });
    expect(aToB1.tripped).toBe(false);
    expect(bToA1.tripped).toBe(false);
  });
});

describe("LoopGuards property: bot-pair rate limit trips exactly once the window is exceeded", () => {
  it("for any max and any number of unique-content messages sent at one instant, tripped === (index > max)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 15 }),
        async (max, sendCount) => {
          const { guards, chain } = setup({
            maxMessagesPerPairPerWindow: max,
            maxRepeatedContent: 1_000_000,
          });
          for (let i = 0; i < sendCount; i++) {
            const result = await guards.check({
              chainId: chain.id,
              fromBotId: "a",
              toBotId: "b",
              text: `unique message #${i}`,
            });
            expect(result.tripped).toBe(i + 1 > max);
            if (result.tripped) return;
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("LoopGuards property: repeated-content detection trips exactly at the configured run length", () => {
  it("for any max and any run of N identical messages, tripped === (N >= max)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 15 }),
        async (max, sendCount) => {
          const { guards, chain } = setup({
            maxMessagesPerPairPerWindow: 1_000_000,
            maxRepeatedContent: max,
          });
          for (let i = 0; i < sendCount; i++) {
            const result = await guards.check({
              chainId: chain.id,
              fromBotId: "a",
              toBotId: "b",
              text: "identical payload",
            });
            expect(result.tripped).toBe(i + 1 >= max);
            if (result.tripped) return;
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("ChainManager property: currentHop always tracks the maximum hop recorded, regardless of arrival order", () => {
  it("for any sequence of hop values, currentHop() ends up as their max", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 30 }),
        (hops) => {
          const events = new InMemoryEventSink();
          const clock = new FakeClock(0);
          const chains = new ChainManager(new InMemoryChainStore(), events, clock, {
            ...DEFAULT_CHAIN_LIMITS,
            maxHops: 1_000_000,
            maxBotMessages: 1_000_000,
          });
          const chain = chains.create({ origin: "bot", mode: "live" });
          for (const hop of hops) chains.recordBotMessage(chain.id, hop);
          expect(chains.currentHop(chain.id)).toBe(Math.max(...hops));
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("LoopGuards.check ordering", () => {
  beforeEach(() => {
    // no-op: each test builds its own isolated ChainManager/guards.
  });

  it("checks rate before repeated content when both would trip on the same message", async () => {
    const { guards, chain } = setup({ maxMessagesPerPairPerWindow: 1, maxRepeatedContent: 2 });
    const first = await guards.check({
      chainId: chain.id,
      fromBotId: "a",
      toBotId: "b",
      text: "x",
    });
    expect(first.tripped).toBe(false);
    // Same text again: both the rate limit (2nd message, max 1) and repeated
    // content (2 in a row, max 2) would independently trip here — the rate
    // check must win since it runs first.
    const second = await guards.check({
      chainId: chain.id,
      fromBotId: "a",
      toBotId: "b",
      text: "x",
    });
    expect(second.tripped).toBe(true);
    expect(second.reason).toMatch(/rate limit/);
  });
});
