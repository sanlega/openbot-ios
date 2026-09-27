import {
  newId,
  type Chain,
  type ChainMode,
  type ChainOrigin,
  type Clock,
} from "@openbot/contracts";
import type { EventSink } from "./event-sink.js";

/** Plan §5 WS2 "Loop protection: Chain limits". */
export interface ChainLimits {
  maxHops: number;
  maxBotMessages: number;
  maxTurns: number;
  maxComputerSteps: number;
  maxWallMin: number;
  maxRoutineDepth: number;
}

export const DEFAULT_CHAIN_LIMITS: ChainLimits = {
  maxHops: 4,
  maxBotMessages: 20,
  maxTurns: 25,
  maxComputerSteps: 200,
  maxWallMin: 60,
  maxRoutineDepth: 2,
};

export type ChainLimitName = keyof ChainLimits;

export interface ChainStore {
  save(chain: Chain): void;
  get(id: string): Chain | undefined;
  list(): Chain[];
}

export class InMemoryChainStore implements ChainStore {
  private readonly chains = new Map<string, Chain>();

  save(chain: Chain): void {
    this.chains.set(chain.id, chain);
  }

  get(id: string): Chain | undefined {
    return this.chains.get(id);
  }

  list(): Chain[] {
    return [...this.chains.values()];
  }
}

export interface CreateChainInput {
  origin: ChainOrigin;
  mode: ChainMode;
  routineRunId?: string;
  routineDepth?: number;
}

export interface ChainLimitHit {
  limit: ChainLimitName;
  value: number;
  max: number;
}

/**
 * Chain lifecycle and counters (plan §4.1 `Chain`, §5 WS2 "Loop protection").
 * Tracks the running totals a chain accrues (turns, bot-to-bot messages, hops,
 * usage, computer steps, wall time) and enforces the hard numeric limits —
 * `chain.limit_reached` pauses the chain, per the plan's WS2 acceptance
 * ("Caps interrupt runs").
 */
export class ChainManager {
  /** Highest `Message.hop` seen so far per chain — not part of the persisted `Chain` entity, tracked here for the `maxHops` guard. */
  private readonly hopByChain = new Map<string, number>();
  /** Wall-clock start, for `maxWallMin`. */
  private readonly startedAtMsByChain = new Map<string, number>();

  constructor(
    private readonly store: ChainStore,
    private readonly events: EventSink,
    private readonly clock: Clock = { now: () => new Date() },
    readonly limits: ChainLimits = DEFAULT_CHAIN_LIMITS,
  ) {}

  create(input: CreateChainInput): Chain {
    const now = this.clock.now();
    const chain: Chain = {
      id: newId("chain"),
      origin: input.origin,
      mode: input.mode,
      routineRunId: input.routineRunId,
      status: "active",
      routineDepth: input.routineDepth ?? 0,
      botMessages: 0,
      turns: 0,
      usd: 0,
      tokens: 0,
      computerSteps: 0,
      wallMin: 0,
      createdAt: now.toISOString(),
    };
    this.store.save(chain);
    this.startedAtMsByChain.set(chain.id, now.getTime());
    return chain;
  }

  get(id: string): Chain {
    const chain = this.store.get(id);
    if (!chain) throw new Error(`ChainManager: unknown chain ${id}`);
    return chain;
  }

  isActive(id: string): boolean {
    return this.get(id).status === "active";
  }

  recordTurnStarted(id: string): ChainLimitHit | undefined {
    const chain = this.get(id);
    this.store.save({ ...chain, turns: chain.turns + 1 });
    return this.enforce(id);
  }

  recordBotMessage(id: string, hop: number): ChainLimitHit | undefined {
    const chain = this.get(id);
    this.store.save({ ...chain, botMessages: chain.botMessages + 1 });
    const currentMax = this.hopByChain.get(id) ?? 0;
    if (hop > currentMax) this.hopByChain.set(id, hop);
    return this.enforce(id);
  }

  currentHop(id: string): number {
    return this.hopByChain.get(id) ?? 0;
  }

  recordComputerSteps(id: string, steps: number): ChainLimitHit | undefined {
    const chain = this.get(id);
    this.store.save({ ...chain, computerSteps: chain.computerSteps + steps });
    return this.enforce(id);
  }

  recordUsage(id: string, usage: { usd?: number; tokens?: number }): ChainLimitHit | undefined {
    const chain = this.get(id);
    this.store.save({
      ...chain,
      usd: chain.usd + (usage.usd ?? 0),
      tokens: chain.tokens + (usage.tokens ?? 0),
    });
    return this.enforce(id);
  }

  /** Recomputes `wallMin` from the chain's creation time and checks the limit; call this periodically (e.g. once per turn) since nothing else advances it. */
  tickWallClock(id: string): ChainLimitHit | undefined {
    const startedMs = this.startedAtMsByChain.get(id);
    if (startedMs === undefined) return undefined;
    const chain = this.get(id);
    const wallMin = (this.clock.now().getTime() - startedMs) / 60_000;
    this.store.save({ ...chain, wallMin });
    return this.enforce(id);
  }

  private enforce(id: string): ChainLimitHit | undefined {
    const chain = this.get(id);
    const hop = this.currentHop(id);
    const hit = firstLimitHit(chain, hop, this.limits);
    if (hit) this.pause(id, "chain.limit_reached", { ...hit });
    return hit;
  }

  pause(
    id: string,
    eventType: "chain.limit_reached" | "guard.tripped",
    payload: Record<string, unknown>,
  ): void {
    const chain = this.get(id);
    if (chain.status !== "active") return;
    this.store.save({ ...chain, status: "paused" });
    this.events.emit({
      ts: this.clock.now().toISOString(),
      type: eventType,
      chainId: id,
      payload,
    });
  }

  resume(id: string): Chain {
    const chain = this.get(id);
    const resumed: Chain = { ...chain, status: "active" };
    this.store.save(resumed);
    this.events.emit({
      ts: this.clock.now().toISOString(),
      type: "chain.resumed",
      chainId: id,
      payload: {},
    });
    return resumed;
  }

  stop(id: string): Chain {
    const chain = this.get(id);
    const stopped: Chain = { ...chain, status: "stopped" };
    this.store.save(stopped);
    this.events.emit({
      ts: this.clock.now().toISOString(),
      type: "chain.stopped",
      chainId: id,
      payload: {},
    });
    return stopped;
  }
}

function firstLimitHit(chain: Chain, hop: number, limits: ChainLimits): ChainLimitHit | undefined {
  if (chain.routineDepth > limits.maxRoutineDepth) {
    return { limit: "maxRoutineDepth", value: chain.routineDepth, max: limits.maxRoutineDepth };
  }
  if (hop > limits.maxHops) return { limit: "maxHops", value: hop, max: limits.maxHops };
  if (chain.botMessages > limits.maxBotMessages) {
    return { limit: "maxBotMessages", value: chain.botMessages, max: limits.maxBotMessages };
  }
  if (chain.turns > limits.maxTurns)
    return { limit: "maxTurns", value: chain.turns, max: limits.maxTurns };
  if (chain.computerSteps > limits.maxComputerSteps) {
    return { limit: "maxComputerSteps", value: chain.computerSteps, max: limits.maxComputerSteps };
  }
  if (chain.wallMin > limits.maxWallMin) {
    return { limit: "maxWallMin", value: chain.wallMin, max: limits.maxWallMin };
  }
  return undefined;
}
