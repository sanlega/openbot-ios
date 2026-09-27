import { FakeClock } from "@openbot/testkit";
import { describe, expect, it } from "vitest";
import { ChainManager, DEFAULT_CHAIN_LIMITS, InMemoryChainStore } from "./chain.js";
import { InMemoryEventSink } from "./event-sink.js";

function setup(limits = DEFAULT_CHAIN_LIMITS) {
  const events = new InMemoryEventSink();
  const clock = new FakeClock(0);
  const chains = new ChainManager(new InMemoryChainStore(), events, clock, limits);
  return { events, clock, chains };
}

describe("ChainManager limits (plan §5 WS2 loop protection)", () => {
  it("starts a chain active with zero counters", () => {
    const { chains } = setup();
    const chain = chains.create({ origin: "user", mode: "live" });
    expect(chain.status).toBe("active");
    expect(chain.turns).toBe(0);
    expect(chains.isActive(chain.id)).toBe(true);
  });

  it("pauses once maxTurns is exceeded", () => {
    const { chains, events } = setup({ ...DEFAULT_CHAIN_LIMITS, maxTurns: 2 });
    const chain = chains.create({ origin: "user", mode: "live" });
    chains.recordTurnStarted(chain.id);
    chains.recordTurnStarted(chain.id);
    const hit = chains.recordTurnStarted(chain.id);
    expect(hit?.limit).toBe("maxTurns");
    expect(chains.isActive(chain.id)).toBe(false);
    expect(events.byType("chain.limit_reached")).toHaveLength(1);
  });

  it("pauses once maxBotMessages is exceeded", () => {
    const { chains } = setup({ ...DEFAULT_CHAIN_LIMITS, maxBotMessages: 1 });
    const chain = chains.create({ origin: "bot", mode: "live" });
    chains.recordBotMessage(chain.id, 1);
    const hit = chains.recordBotMessage(chain.id, 1);
    expect(hit?.limit).toBe("maxBotMessages");
  });

  it("pauses once maxHops is exceeded, tracking the highest hop seen", () => {
    const { chains } = setup({ ...DEFAULT_CHAIN_LIMITS, maxHops: 2 });
    const chain = chains.create({ origin: "bot", mode: "live" });
    chains.recordBotMessage(chain.id, 1);
    expect(chains.currentHop(chain.id)).toBe(1);
    chains.recordBotMessage(chain.id, 2);
    expect(chains.isActive(chain.id)).toBe(true);
    const hit = chains.recordBotMessage(chain.id, 3);
    expect(hit?.limit).toBe("maxHops");
  });

  it("pauses once maxComputerSteps is exceeded", () => {
    const { chains } = setup({ ...DEFAULT_CHAIN_LIMITS, maxComputerSteps: 5 });
    const chain = chains.create({ origin: "bot", mode: "live" });
    chains.recordComputerSteps(chain.id, 3);
    const hit = chains.recordComputerSteps(chain.id, 3);
    expect(hit?.limit).toBe("maxComputerSteps");
  });

  it("pauses once maxWallMin is exceeded via tickWallClock", () => {
    const { chains, clock } = setup({ ...DEFAULT_CHAIN_LIMITS, maxWallMin: 1 });
    const chain = chains.create({ origin: "user", mode: "live" });
    clock.advance(2 * 60_000);
    const hit = chains.tickWallClock(chain.id);
    expect(hit?.limit).toBe("maxWallMin");
  });

  it("routineDepth over the max refuses to start active", () => {
    const { chains } = setup({ ...DEFAULT_CHAIN_LIMITS, maxRoutineDepth: 2 });
    const chain = chains.create({ origin: "routine", mode: "live", routineDepth: 3 });
    const hit = chains.recordTurnStarted(chain.id);
    expect(hit?.limit).toBe("maxRoutineDepth");
  });

  it("checks limits in a fixed precedence order (routineDepth first)", () => {
    const { chains } = setup({ ...DEFAULT_CHAIN_LIMITS, maxRoutineDepth: 0, maxTurns: 0 });
    const chain = chains.create({ origin: "routine", mode: "live", routineDepth: 1 });
    const hit = chains.recordTurnStarted(chain.id);
    expect(hit?.limit).toBe("maxRoutineDepth");
  });

  it("resume reactivates a paused chain and emits chain.resumed", () => {
    const { chains, events } = setup({ ...DEFAULT_CHAIN_LIMITS, maxTurns: 1 });
    const chain = chains.create({ origin: "user", mode: "live" });
    chains.recordTurnStarted(chain.id);
    chains.recordTurnStarted(chain.id);
    expect(chains.isActive(chain.id)).toBe(false);
    chains.resume(chain.id);
    expect(chains.isActive(chain.id)).toBe(true);
    expect(events.byType("chain.resumed")).toHaveLength(1);
  });

  it("stop marks the chain stopped and emits chain.stopped", () => {
    const { chains, events } = setup();
    const chain = chains.create({ origin: "user", mode: "live" });
    chains.stop(chain.id);
    expect(chains.get(chain.id).status).toBe("stopped");
    expect(events.byType("chain.stopped")).toHaveLength(1);
  });

  it("does not double-pause (and double-emit) an already-paused chain", () => {
    const { chains, events } = setup({ ...DEFAULT_CHAIN_LIMITS, maxTurns: 1 });
    const chain = chains.create({ origin: "user", mode: "live" });
    chains.recordTurnStarted(chain.id);
    chains.recordTurnStarted(chain.id);
    chains.recordTurnStarted(chain.id);
    expect(events.byType("chain.limit_reached")).toHaveLength(1);
  });
});
