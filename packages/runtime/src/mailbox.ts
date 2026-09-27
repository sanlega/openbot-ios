import { newId } from "@openbot/contracts";
import type {
  Clock,
  EngineDriver,
  EngineEvent,
  EngineId,
  MessageKind,
  ToolApprovalRequest,
  TurnHandle,
  TurnHooks,
  TurnInput,
} from "@openbot/contracts";
import type { MessageStore } from "./message-store.js";
import type { SessionStore } from "./session-store.js";
import type { BrokerRequest } from "./broker-types.js";
import type { PermissionBroker } from "./broker.js";
import type { SpendCaps } from "./caps.js";
import type { ChainManager } from "./chain.js";
import type { DeliveryService } from "./delivery.js";
import type { EventSink } from "./event-sink.js";
import type { TurnStore } from "./turn-store.js";

export interface EnqueueTurnInput extends TurnInput {
  engine: EngineId;
  chainId: string;
  /** The Bot's own DM thread, for its direct reply (never gated — see `packages/runtime` module docs). */
  threadId: string;
  spendLimits?: { dailyUsdPerBot?: number; dailyUsdGlobal?: number };
  /** Overrides the default tool -> `BrokerRequest` classification, for tests/callers that know more about a specific tool (e.g. a computer action's observed target label). */
  classifyApproval?: (r: ToolApprovalRequest) => Partial<BrokerRequest>;
  /**
   * Called once the turn id exists and before the engine starts, for inputs that
   * depend on it — e.g. the OpenBot MCP server, whose session token names the turn.
   */
  prepareTurn?: (turnId: string) => Promise<Partial<Pick<TurnInput, "mcpServers">>>;
}

export interface TurnOutcome {
  status: "completed" | "failed" | "interrupted" | "refused";
  turnId?: string;
  sessionId?: string;
  text?: string;
  reason?: string;
}

interface QueuedTurn {
  input: EnqueueTurnInput;
  resolve: (outcome: TurnOutcome) => void;
}

interface ActiveTurn {
  handle: TurnHandle;
  turnId: string;
}

export interface MailboxOptions {
  drivers: Partial<Record<EngineId, EngineDriver>>;
  broker: PermissionBroker;
  chains: ChainManager;
  delivery: DeliveryService;
  events: EventSink;
  turns: TurnStore;
  spendCaps?: SpendCaps;
  clock: Clock;
  /** When set, the Bot's direct reply is persisted to its DM thread. */
  messages?: MessageStore;
  /** When set, a turn without an explicit `sessionId` resumes the Bot's last engine session. */
  sessions?: SessionStore;
}

const READ_ONLY_TOOL_RE = /^(read|get|list|search|observe|screenshot|status)/i;
const MESSAGE_USER_TOOL = "message_user";
const SEND_MESSAGE_TOOL = "send_message";

function defaultClassify(r: ToolApprovalRequest): Partial<BrokerRequest> {
  const input = (r.input ?? {}) as Record<string, unknown>;
  const target =
    typeof input.target === "string"
      ? input.target
      : typeof input.path === "string"
        ? input.path
        : typeof input.url === "string"
          ? input.url
          : undefined;
  return {
    kind: "tool",
    action: r.toolName,
    target,
    readOnly: READ_ONLY_TOOL_RE.test(r.toolName),
    args: input,
  };
}

/**
 * The mailbox (plan §5 WS2 "Mailbox and delivery"): one active turn per Bot,
 * FIFO-queued, with user-driven steer/interrupt/stop. Wires `EngineDriver`'s
 * `TurnHooks` to the rest of the runtime: `emit()` fans out into `OBEvent`s
 * and chain/usage bookkeeping; `requestApproval()` routes through the
 * {@link PermissionBroker}. `message_user`/`send_message` tool calls are
 * recognized specially and routed through `DeliveryService` (which already
 * knows how to gate `dry_run` chains for those two tools per plan §5 WS2).
 */
export class Mailbox {
  private readonly queues = new Map<string, QueuedTurn[]>();
  private readonly active = new Map<string, ActiveTurn>();

  constructor(private readonly opts: MailboxOptions) {}

  submit(input: EnqueueTurnInput): Promise<TurnOutcome> {
    return new Promise((resolve) => {
      const queue = this.queues.get(input.bot.id) ?? [];
      queue.push({ input, resolve });
      this.queues.set(input.bot.id, queue);
      this.pump(input.bot.id);
    });
  }

  isBusy(botId: string): boolean {
    return this.active.has(botId);
  }

  queueLength(botId: string): number {
    return this.queues.get(botId)?.length ?? 0;
  }

  async steer(botId: string, text: string): Promise<void> {
    const active = this.active.get(botId);
    if (!active) throw new Error(`Mailbox: no active turn for bot ${botId}`);
    await active.handle.steer(text);
  }

  async interrupt(botId: string): Promise<void> {
    const active = this.active.get(botId);
    if (!active) return;
    await active.handle.interrupt();
  }

  /** Interrupts the active turn (if any) and drains — refuses — every queued turn for this Bot. */
  async stop(botId: string): Promise<void> {
    await this.interrupt(botId);
    const queue = this.queues.get(botId) ?? [];
    this.queues.set(botId, []);
    for (const item of queue) item.resolve({ status: "refused", reason: "stopped" });
  }

  private pump(botId: string): void {
    if (this.active.has(botId)) return;
    const queue = this.queues.get(botId);
    const next = queue?.shift();
    if (!next) return;
    void this.runTurn(botId, next);
  }

  private async runTurn(botId: string, item: QueuedTurn): Promise<void> {
    const { input, resolve } = item;

    const chainHit = this.opts.chains.recordTurnStarted(input.chainId);
    const chain = this.opts.chains.get(input.chainId);
    if (chain.status !== "active" || chainHit) {
      resolve({ status: "refused", reason: `chain is ${chain.status}` });
      this.pump(botId);
      return;
    }

    const driver = this.opts.drivers[input.engine];
    if (!driver) {
      resolve({
        status: "refused",
        reason: `no EngineDriver registered for engine "${input.engine}"`,
      });
      this.pump(botId);
      return;
    }

    if (input.spendLimits) {
      const spendCheck = await this.opts.spendCaps?.checkBeforeTurn({
        botId,
        chainId: input.chainId,
        ...input.spendLimits,
      });
      if (spendCheck && !spendCheck.allowed) {
        resolve({ status: "refused", reason: spendCheck.reason });
        this.pump(botId);
        return;
      }
    }

    const storedSessionId = input.sessionId
      ? undefined
      : this.opts.sessions?.get(botId, input.engine);
    const sessionId = input.sessionId ?? storedSessionId;
    const turnId = newId("turn");
    const startedAt = this.opts.clock.now().toISOString();
    this.opts.turns.create({
      id: turnId,
      botId,
      chainId: input.chainId,
      engine: input.engine,
      model: input.model,
      effort: input.effort,
      sessionId,
    });
    this.opts.events.emit({
      ts: startedAt,
      type: "turn.started",
      botId,
      chainId: input.chainId,
      turnId,
      payload: { engine: input.engine, model: input.model },
    });

    let turnInput: TurnInput = { ...input, sessionId };
    if (input.prepareTurn) {
      try {
        turnInput = { ...turnInput, ...(await input.prepareTurn(turnId)) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.opts.turns.update(turnId, { status: "failed" });
        this.opts.events.emit({
          ts: this.opts.clock.now().toISOString(),
          type: "turn.failed",
          botId,
          chainId: input.chainId,
          turnId,
          payload: { errorMessage: reason },
        });
        resolve({ status: "failed", turnId, reason });
        this.pump(botId);
        return;
      }
    }

    let replyText = "";
    const pendingToolEffects: Promise<void>[] = [];

    const hooks: TurnHooks = {
      emit: (e: EngineEvent) => {
        this.handleEngineEvent({ botId, input, turnId, event: e, pendingToolEffects }, (t) => {
          replyText += t;
        });
      },
      requestApproval: (r: ToolApprovalRequest) => this.handleApprovalRequest(botId, input, r),
    };

    const active: ActiveTurn = { handle: driver.startTurn(turnInput, hooks), turnId };
    this.active.set(botId, active);

    let result;
    try {
      result = await active.handle.done;
    } finally {
      this.active.delete(botId);
    }
    await Promise.all(pendingToolEffects);

    const status = result.isError
      ? result.errorMessage === "interrupted"
        ? "interrupted"
        : "failed"
      : "completed";
    this.opts.turns.update(turnId, { status, sessionId: result.sessionId });
    if (status === "completed" && result.sessionId) {
      this.opts.sessions?.set(botId, input.engine, result.sessionId);
    } else if (status === "failed" && storedSessionId) {
      // Don't keep resuming a session the engine just failed on.
      this.opts.sessions?.clear(botId, input.engine);
    }
    this.opts.events.emit({
      ts: this.opts.clock.now().toISOString(),
      type:
        status === "completed"
          ? "turn.completed"
          : status === "interrupted"
            ? "turn.interrupted"
            : "turn.failed",
      botId,
      chainId: input.chainId,
      turnId,
      payload: { text: replyText, errorMessage: result.errorMessage },
    });

    if (status === "completed" && replyText.length > 0) {
      // A dry-run chain has zero side effects, including the Bot's thread.
      const message =
        chain.mode === "dry_run"
          ? undefined
          : this.opts.messages?.create({
              threadId: input.threadId,
              author: { type: "bot", id: botId },
              text: replyText,
              attachments: [],
              chainId: input.chainId,
              hop: 0,
              proactive: false,
              delivery: "delivered",
              pushed: false,
            });
      this.opts.events.emit({
        ts: message?.createdAt ?? this.opts.clock.now().toISOString(),
        type: "message.created",
        botId,
        threadId: input.threadId,
        chainId: input.chainId,
        turnId,
        payload: { text: replyText, proactive: false, messageId: message?.id },
      });
    }

    resolve({
      status,
      turnId,
      sessionId: result.sessionId,
      text: replyText,
      reason: result.errorMessage,
    });
    this.pump(botId);
  }

  private handleEngineEvent(
    ctx: {
      botId: string;
      input: EnqueueTurnInput;
      turnId: string;
      event: EngineEvent;
      pendingToolEffects: Promise<void>[];
    },
    onText: (text: string) => void,
  ): void {
    const { botId, input, turnId, event } = ctx;
    const now = this.opts.clock.now().toISOString();
    switch (event.type) {
      case "session_started":
        this.opts.turns.update(turnId, { sessionId: event.sessionId });
        return;
      case "text_delta":
        onText(event.text);
        this.opts.events.emit({
          ts: now,
          type: "message.delta",
          botId,
          chainId: input.chainId,
          turnId,
          payload: { text: event.text },
        });
        return;
      case "tool_started":
        this.opts.events.emit({
          ts: now,
          type: "tool.started",
          botId,
          chainId: input.chainId,
          turnId,
          payload: { toolName: event.toolName, toolUseId: event.toolUseId, input: event.input },
        });
        if (event.toolName === MESSAGE_USER_TOOL || event.toolName === SEND_MESSAGE_TOOL) {
          ctx.pendingToolEffects.push(this.deliverTool(botId, input, event));
        }
        return;
      case "tool_completed":
        this.opts.events.emit({
          ts: now,
          type: "tool.completed",
          botId,
          chainId: input.chainId,
          turnId,
          payload: { toolUseId: event.toolUseId, output: event.output, isError: event.isError },
        });
        return;
      case "usage": {
        const usd = event.usd ?? 0;
        const tokens = event.inputTokens + event.outputTokens;
        this.opts.chains.recordUsage(input.chainId, { usd, tokens });
        if (this.opts.spendCaps && input.spendLimits) {
          void this.opts.spendCaps
            .recordUsage({ botId, chainId: input.chainId, usd, tokens, ...input.spendLimits })
            .then((r) => {
              if (!r.allowed) void this.interrupt(botId);
            });
        }
        return;
      }
      case "error":
        this.opts.events.emit({
          ts: now,
          type: "error",
          botId,
          chainId: input.chainId,
          turnId,
          payload: { message: event.message, authFailure: event.authFailure ?? false },
        });
        return;
    }
  }

  private async deliverTool(
    botId: string,
    input: EnqueueTurnInput,
    event: { toolName: string; input: unknown },
  ): Promise<void> {
    const args = (event.input ?? {}) as Record<string, unknown>;
    const mode = this.opts.chains.get(input.chainId).mode;
    if (event.toolName === MESSAGE_USER_TOOL) {
      await this.opts.delivery.sendBotToUser({
        chainId: input.chainId,
        botId,
        threadId: input.threadId,
        kind: (args.kind as MessageKind) ?? "result",
        text: String(args.body ?? args.text ?? ""),
        options: Array.isArray(args.options) ? (args.options as string[]) : undefined,
        deadline: typeof args.deadline === "string" ? args.deadline : undefined,
        dedupeKey: typeof args.dedupe_key === "string" ? args.dedupe_key : undefined,
        mode,
      });
      return;
    }
    // send_message
    await this.opts.delivery.sendBotToBot({
      chainId: input.chainId,
      fromBotId: botId,
      toBotId: String(args.bot ?? ""),
      toThreadId: typeof args.toThreadId === "string" ? args.toThreadId : String(args.bot ?? ""),
      text: String(args.text ?? ""),
      mode,
    });
  }

  private async handleApprovalRequest(
    botId: string,
    input: EnqueueTurnInput,
    r: ToolApprovalRequest,
  ): Promise<"allow" | "deny"> {
    const classified = { ...defaultClassify(r), ...(input.classifyApproval?.(r) ?? {}) };
    const req: BrokerRequest = {
      botId,
      chainId: input.chainId,
      kind: classified.kind ?? "tool",
      action: classified.action ?? r.toolName,
      target: classified.target,
      sideEffect: classified.sideEffect,
      readOnly: classified.readOnly,
      inWorkspace: classified.inWorkspace,
      args: classified.args ?? ((r.input ?? {}) as Record<string, unknown>),
      summary: classified.summary ?? `${r.toolName} requested by ${botId}`,
      detail: classified.detail ?? JSON.stringify(r.input ?? {}),
    };
    const decision = await this.opts.broker.evaluate(req, {
      mode: this.opts.chains.get(input.chainId).mode,
      preset: input.permission,
    });
    if (decision.outcome === "allow" || decision.outcome === "simulate") return "allow";
    if (decision.outcome === "deny") return "deny";
    return this.opts.broker.waitForApproval(decision.approvalId as string);
  }
}
