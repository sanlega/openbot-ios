/**
 * `@openbot/runtime` (plan §5 WS2: mailbox, chains, delivery, broker incl.
 * dry-run simulation, guards, caps, usage).
 *
 * {@link createRuntime} wires every WS2 piece together behind sensible
 * in-memory defaults, so callers (WS1's `core`, and WS2's own tests) get a
 * working runtime from fakes alone. Every port this package depends on but
 * doesn't own — `DecisionService` (WS7/Jev), `EngineDriver` (WS3),
 * `NotifyGate` (WS8) — is either required or defaults to an explicit
 * stand-in (never silently wrong): see {@link RuntimeOptions}.
 */
import type { Clock, DecisionService, EngineDriver, EngineId } from "@openbot/contracts";
import { InMemoryApprovalStore, type ApprovalStore } from "./approval-store.js";
import { PermissionBroker, type SchedulingClock } from "./broker.js";
import { InMemoryCapCounterStore, CapCounterService, type CapCounterStore } from "./cap-counter.js";
import { InMemorySpendLedger, SpendCaps, type SpendLedger } from "./caps.js";
import { ChainManager, InMemoryChainStore, type ChainLimits, type ChainStore } from "./chain.js";
import { DeliveryService } from "./delivery.js";
import { InMemoryEventSink, type EventSink } from "./event-sink.js";
import { LoopGuards, type LoopGuardOptions } from "./guards.js";
import { Mailbox } from "./mailbox.js";
import { InMemoryMessageStore, type MessageStore } from "./message-store.js";
import { PassthroughNotifyGate, type NotifyGate } from "./notify-gate.js";
import { InMemoryRuleStore, type RuleStore } from "./rules.js";
import { InMemorySessionStore, type SessionStore } from "./session-store.js";
import { InMemoryTurnStore, type TurnStore } from "./turn-store.js";

export interface RuntimeOptions {
  /** WS7's Jev client (or `FakeDecisionService`/`FakeJevServer` in tests) — required, no default: every gate WS2 owns (risk, loop) is meaningless without it. */
  decisions: DecisionService;
  /** WS3's engine drivers (or `FakeEngineDriver` in tests), keyed by `EngineId` — required, at least one entry. */
  drivers: Partial<Record<EngineId, EngineDriver>>;
  /** Defaults to `PassthroughNotifyGate` — delivers everything, pushes only blockers. **Not** WS8's real S4-S7/S10 policy; pass `packages/cos`'s gate once it exists. */
  notify?: NotifyGate;
  clock?: SchedulingClock;
  chainLimits?: ChainLimits;
  approvalTimeoutMs?: number;
  loopGuards?: Pick<
    LoopGuardOptions,
    "maxMessagesPerPairPerWindow" | "pairWindowMs" | "maxRepeatedContent"
  >;
  events?: EventSink;
  chainStore?: ChainStore;
  ruleStore?: RuleStore;
  approvalStore?: ApprovalStore;
  messageStore?: MessageStore;
  capCounterStore?: CapCounterStore;
  spendLedger?: SpendLedger;
  sessionStore?: SessionStore;
  turnStore?: TurnStore;
}

/** Every WS2 piece, wired together and ready to use — see plan §5 WS2 for what each one owns. */
export interface Runtime {
  events: EventSink;
  chains: ChainManager;
  rules: RuleStore;
  approvals: ApprovalStore;
  broker: PermissionBroker;
  guards: LoopGuards;
  messages: MessageStore;
  notify: NotifyGate;
  delivery: DeliveryService;
  capCounters: CapCounterService;
  spendLedger: SpendLedger;
  spendCaps: SpendCaps;
  sessions: SessionStore;
  turns: TurnStore;
  mailbox: Mailbox;
  clock: SchedulingClock;
}

function defaultClock(): SchedulingClock {
  return {
    now: () => new Date(),
    setTimeout: (fn, delayMs) => setTimeout(fn, delayMs) as unknown as number,
    clearTimeout: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
  };
}

export function createRuntime(opts: RuntimeOptions): Runtime {
  const clock: Clock & SchedulingClock = opts.clock ?? defaultClock();
  const events = opts.events ?? new InMemoryEventSink();
  const chainStore = opts.chainStore ?? new InMemoryChainStore();
  const chains = new ChainManager(chainStore, events, clock, opts.chainLimits);

  const ruleStore = opts.ruleStore ?? new InMemoryRuleStore();
  const approvalStore = opts.approvalStore ?? new InMemoryApprovalStore(clock);
  const broker = new PermissionBroker({
    ruleStore,
    approvalStore,
    events,
    decisions: opts.decisions,
    clock,
    approvalTimeoutMs: opts.approvalTimeoutMs,
  });

  const guards = new LoopGuards({
    events,
    chains,
    decisions: opts.decisions,
    clock,
    ...opts.loopGuards,
  });

  const messages = opts.messageStore ?? new InMemoryMessageStore(() => clock.now().toISOString());
  const notify = opts.notify ?? new PassthroughNotifyGate();
  const delivery = new DeliveryService({ messages, chains, guards, events, notify, clock });

  const capCounterStore = opts.capCounterStore ?? new InMemoryCapCounterStore();
  const capCounters = new CapCounterService(capCounterStore, clock);

  const spendLedger = opts.spendLedger ?? new InMemorySpendLedger();
  const spendCaps = new SpendCaps({ ledger: spendLedger, notify, events, clock });

  const sessions = opts.sessionStore ?? new InMemorySessionStore();
  const turns = opts.turnStore ?? new InMemoryTurnStore(() => clock.now().toISOString());

  const mailbox = new Mailbox({
    drivers: opts.drivers,
    broker,
    chains,
    delivery,
    events,
    turns,
    spendCaps,
    clock,
    messages,
    sessions,
  });

  return {
    events,
    chains,
    rules: ruleStore,
    approvals: approvalStore,
    broker,
    guards,
    messages,
    notify,
    delivery,
    capCounters,
    spendLedger,
    spendCaps,
    sessions,
    turns,
    mailbox,
    clock,
  };
}

export * from "./approval-store.js";
export * from "./broker-types.js";
export * from "./broker.js";
export * from "./cap-counter-sqlite.js";
export * from "./cap-counter.js";
export * from "./caps.js";
export * from "./chain.js";
export * from "./delivery.js";
export * from "./event-sink.js";
export * from "./guards.js";
export * from "./mailbox.js";
export * from "./message-store.js";
export * from "./notify-gate.js";
export * from "./prompt.js";
export * from "./routing.js";
export * from "./rules.js";
export * from "./session-store.js";
export * from "./turn-store.js";
