import type { ChainMode, Clock, Message, MessageKind } from "@openbot/contracts";
import type { ChainManager } from "./chain.js";
import type { EventSink } from "./event-sink.js";
import type { GuardResult, LoopGuards } from "./guards.js";
import type { MessageStore } from "./message-store.js";
import type { NotifyGate } from "./notify-gate.js";

export interface DeliveryOptions {
  messages: MessageStore;
  chains: ChainManager;
  guards: LoopGuards;
  events: EventSink;
  notify: NotifyGate;
  clock: Clock;
}

export interface SendBotToBotInput {
  chainId: string;
  fromBotId: string;
  toBotId: string;
  /** The recipient Bot's DM thread id (resolved by the caller — thread CRUD is WS1's `core`). */
  toThreadId: string;
  text: string;
  mode: ChainMode;
  /** The delegation this message belongs to; its report comes back to the sender. */
  delegationId?: string;
}

export type DeliveryOutcome = "delivered" | "simulated" | "refused";

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  reason?: string;
  message?: Message;
  guard?: GuardResult;
}

export interface SendBotToUserInput {
  chainId: string;
  botId: string;
  threadId: string;
  kind: MessageKind;
  text: string;
  options?: string[];
  deadline?: string;
  dedupeKey?: string;
  mode: ChainMode;
}

/**
 * Bot-to-bot and bot-to-user message delivery (plan §5 WS2 "Mailbox and
 * delivery"). Bot-to-bot tracks hops against `ChainManager`'s `maxHops` and
 * runs `LoopGuards` on every message; bot-to-user never writes a message
 * directly — it always calls the injected {@link NotifyGate} first (WS8), per
 * the plan's explicit "never sends directly" rule.
 *
 * In a `dry_run` chain, both kinds are simulated per plan §5 WS2: recorded as
 * `action.simulated`, no `Message` row, and neither `NotifyGate` nor the
 * recipient's mailbox is ever touched — matching the plan's explicit list of
 * dry-run-only-recorded tools (`message_user`, `send_message`, `create_bot`,
 * `create_routine`).
 */
export class DeliveryService {
  constructor(private readonly opts: DeliveryOptions) {}

  async sendBotToBot(input: SendBotToBotInput): Promise<DeliveryResult> {
    const chain = this.opts.chains.get(input.chainId);
    if (chain.status !== "active") {
      return { outcome: "refused", reason: `chain is ${chain.status}, not active` };
    }

    const nextHop = this.opts.chains.currentHop(input.chainId) + 1;
    const limits = this.opts.chains.limits;
    if (nextHop > limits.maxHops) {
      this.opts.chains.pause(input.chainId, "chain.limit_reached", {
        limit: "maxHops",
        value: nextHop,
        max: limits.maxHops,
      });
      return { outcome: "refused", reason: `max hops (${limits.maxHops}) exceeded` };
    }

    const guard = await this.opts.guards.check({
      chainId: input.chainId,
      fromBotId: input.fromBotId,
      toBotId: input.toBotId,
      text: input.text,
    });
    if (guard.tripped) return { outcome: "refused", reason: guard.reason, guard };

    const now = this.opts.clock.now().toISOString();

    if (input.mode === "dry_run") {
      this.opts.events.emit({
        ts: now,
        type: "action.simulated",
        botId: input.fromBotId,
        chainId: input.chainId,
        payload: {
          kind: "tool",
          action: "send_message",
          target: input.toBotId,
          args: { text: input.text },
        },
      });
      this.opts.chains.recordBotMessage(input.chainId, nextHop);
      return { outcome: "simulated", reason: "simulated: not executed (dry run)" };
    }

    const message = this.opts.messages.create({
      threadId: input.toThreadId,
      author: { type: "bot", id: input.fromBotId },
      text: input.text,
      attachments: [],
      chainId: input.chainId,
      hop: nextHop,
      proactive: false,
      delivery: "delivered",
      pushed: false,
    });
    this.opts.events.emit({
      ts: message.createdAt,
      type: "message.created",
      botId: input.toBotId,
      threadId: input.toThreadId,
      chainId: input.chainId,
      payload: {
        messageId: message.id,
        fromBotId: input.fromBotId,
        hop: nextHop,
        text: input.text,
        author: "bot",
      },
    });
    this.opts.events.emit({
      ts: message.createdAt,
      type: "handoff.sent",
      botId: input.fromBotId,
      chainId: input.chainId,
      payload: {
        toBotId: input.toBotId,
        messageId: message.id,
        delegationId: input.delegationId,
      },
    });
    this.opts.chains.recordBotMessage(input.chainId, nextHop);
    return { outcome: "delivered", message };
  }

  async sendBotToUser(input: SendBotToUserInput): Promise<DeliveryResult> {
    const now = this.opts.clock.now().toISOString();

    if (input.mode === "dry_run") {
      this.opts.events.emit({
        ts: now,
        type: "action.simulated",
        botId: input.botId,
        chainId: input.chainId,
        payload: {
          kind: "tool",
          action: "message_user",
          args: { kind: input.kind, text: input.text },
        },
      });
      return { outcome: "simulated", reason: "simulated: not executed (dry run)" };
    }

    const result = await this.opts.notify.notify({
      botId: input.botId,
      chainId: input.chainId,
      kind: input.kind,
      body: input.text,
      options: input.options,
      deadline: input.deadline,
      dedupeKey: input.dedupeKey,
    });

    const message = this.opts.messages.create({
      threadId: input.threadId,
      author: { type: "bot", id: input.botId },
      text: input.text,
      attachments: [],
      chainId: input.chainId,
      hop: 0,
      proactive: true,
      kind: input.kind,
      options: input.options,
      deadline: input.deadline,
      dedupeKey: input.dedupeKey,
      delivery: result.delivery,
      pushed: result.pushed,
      notifyDecisionId: result.notifyDecisionId,
    });

    this.opts.events.emit({
      ts: message.createdAt,
      type:
        result.delivery === "delivered"
          ? "message.created"
          : result.delivery === "held"
            ? "message.held"
            : "message.merged",
      botId: input.botId,
      threadId: input.threadId,
      chainId: input.chainId,
      payload: {
        messageId: message.id,
        kind: input.kind,
        pushed: result.pushed,
        text: input.text,
        proactive: true,
        delivery: result.delivery,
      },
    });

    return { outcome: "delivered", message };
  }
}
