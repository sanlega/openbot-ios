import { newId, type Delegation, type Message } from "@openbot/contracts";
import type { CoreContext } from "./context.js";

/** Requester -> assignee messages per delegation before the harness refuses more (no ping-pong). */
export const MAX_ROUND_TRIPS = 8;
/** Open delegations one Bot may have at once. */
export const MAX_OPEN_PER_REQUESTER = 5;
/** No engine activity for this long while working counts as stalled. */
export const STALL_AFTER_MS = 10 * 60_000;
/** Tasks one requester may hand to the same assignee per hour (bounds a fail-and-retry cycle). */
export const MAX_PER_PAIR_PER_HOUR = 6;
const MAX_RESULT_CHARS = 6000;

/** How a turn on behalf of a delegation ended (a subset of the runtime's `TurnOutcome`). */
export interface DelegatedTurnOutcome {
  status: "completed" | "failed" | "interrupted" | "refused";
  text?: string;
  reason?: string;
  /** The text is the harness's stand-in for a turn that returned none. */
  synthesized?: boolean;
}

export type OpenResult =
  { ok: true; delegation: Delegation; continued: boolean } | { ok: false; reason: string };

/**
 * The lifecycle of tasks one Bot hands to another. The harness, not the model, decides the state:
 * a delegated turn that ends completes, fails or interrupts the delegation, and the requester is
 * woken with the outcome (`onWake`) once. Worker questions and blockers are shown in the requester's
 * thread, the conversation the human is actually in.
 */
export class DelegationTracker {
  /** Starts the requester's turn about a delegation update (wired by the server bootstrap). */
  onWake?: (delegation: Delegation) => Promise<void> | void;
  private readonly lastTouch = new Map<string, number>();
  /** Bot id -> the delegation its running turn works on (tools called in that turn belong to it). */
  private readonly bound = new Map<string, string>();
  /** Delegation id -> turns queued or running for it: it settles when the last one ends. */
  private readonly pendingTurns = new Map<string, number>();
  /** Delegation id -> forms/approvals the human still owes: it works again when none remain. */
  private readonly waits = new Map<string, number>();

  constructor(private readonly ctx: CoreContext) {}

  private get repo() {
    return this.ctx.repos.delegations;
  }

  private now(): Date {
    return this.ctx.clock.now();
  }

  get(id: string): Delegation | undefined {
    return this.repo.getById(id);
  }

  /** The newest open delegation this Bot is the assignee of (for events outside any turn). */
  openFor(assigneeBotId: string): Delegation | undefined {
    return this.repo.findOpenForAssignee(assigneeBotId);
  }

  /** The delegation the Bot's RUNNING turn belongs to; a turn of any other kind has none. */
  current(botId: string): Delegation | undefined {
    const id = this.bound.get(botId);
    const d = id ? this.repo.getById(id) : undefined;
    return d && OPEN.has(d.state) ? d : undefined;
  }

  bindTurn(botId: string, delegationId: string): void {
    this.bound.set(botId, delegationId);
  }

  unbindTurn(botId: string, delegationId: string): void {
    if (this.bound.get(botId) === delegationId) this.bound.delete(botId);
  }

  /** A turn for this delegation is queued: it must not settle before that turn ends. */
  expectTurn(id: string): void {
    this.pendingTurns.set(id, (this.pendingTurns.get(id) ?? 0) + 1);
  }

  /** A requester -> assignee message: continues the open delegation between them or starts one. */
  open(input: {
    requesterBotId: string;
    assigneeBotId: string;
    chainId: string;
    text: string;
  }): OpenResult {
    // A worker that delegates onward keeps the user's conversation as the place results show.
    const parent = this.current(input.requesterBotId);
    const ownerThread =
      (parent ? this.ctx.repos.threads.getById(parent.ownerThreadId) : undefined) ??
      this.ctx.repos.threads.getByBotId(input.requesterBotId);
    if (!ownerThread) return { ok: false, reason: `no thread for bot ${input.requesterBotId}` };
    const existing = this.repo.findOpenBetween(input.requesterBotId, input.assigneeBotId);
    const now = this.now();
    if (existing) {
      if (existing.roundTrips >= MAX_ROUND_TRIPS) {
        return {
          ok: false,
          reason: `this task already had ${MAX_ROUND_TRIPS} messages back and forth; tell the user where it stands instead of sending more`,
        };
      }
      const updated = this.repo.update(
        existing.id,
        {
          // Still waiting on the human for a form or a card? A follow-up doesn't change that.
          state: (this.waits.get(existing.id) ?? 0) > 0 ? "input_required" : "working",
          statusMessage: undefined,
          roundTrips: existing.roundTrips + 1,
          wakeKind: existing.wakeKind === "stalled" ? undefined : existing.wakeKind,
          lastEventAt: now.toISOString(),
        },
        now,
      )!;
      return { ok: true, delegation: updated, continued: true };
    }
    const recent = this.repo
      .list({ requesterBotId: input.requesterBotId, assigneeBotId: input.assigneeBotId })
      .filter((d) => now.getTime() - new Date(d.createdAt).getTime() < 3_600_000);
    if (recent.length >= MAX_PER_PAIR_PER_HOUR) {
      return {
        ok: false,
        reason: `${recent.length} tasks went to this bot in the last hour and it keeps not finishing; tell the user what is wrong instead of sending more`,
      };
    }
    const open = this.repo.list({ requesterBotId: input.requesterBotId, open: true });
    if (open.length >= MAX_OPEN_PER_REQUESTER) {
      return {
        ok: false,
        reason: `already ${open.length} tasks in flight; wait for reports before delegating more`,
      };
    }
    const delegation: Delegation = {
      id: newId("delegation"),
      chainId: input.chainId,
      requesterBotId: input.requesterBotId,
      assigneeBotId: input.assigneeBotId,
      ownerThreadId: ownerThread.id,
      title: titleOf(input.text),
      state: "submitted",
      roundTrips: 1,
      wakePending: false,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastEventAt: now.toISOString(),
    };
    this.repo.create(delegation);
    return { ok: true, delegation, continued: false };
  }

  /** The delivery to the assignee failed: nothing was handed over. */
  abandon(id: string, reason: string): void {
    const d = this.repo.getById(id);
    if (!d || d.state !== "submitted") return;
    this.repo.update(id, { state: "failed", statusMessage: reason }, this.now());
  }

  async announce(d: Delegation): Promise<void> {
    await this.ctx.eventBus.publish({
      type: "delegation.updated",
      botId: d.assigneeBotId,
      threadId: d.ownerThreadId,
      chainId: d.chainId,
      payload: { delegation: d },
    });
  }

  /** The assignee's turn began (or resumed) on this engine. */
  async started(id: string, engine: string): Promise<void> {
    const d = this.repo.getById(id);
    if (!d) return;
    const patch: Partial<Delegation> = { engine, lastEventAt: this.now().toISOString() };
    if (d.state === "submitted") patch.state = "working";
    if (d.state === "input_required" && (this.waits.get(id) ?? 0) === 0) patch.state = "working";
    if (d.wakeKind === "stalled") patch.wakeKind = undefined;
    const updated = this.repo.update(id, patch, this.now());
    if (updated) await this.announce(updated);
  }

  /** Engine activity from the assignee keeps the delegation from looking stalled. */
  touch(assigneeBotId: string): void {
    const now = this.now().getTime();
    if (now - (this.lastTouch.get(assigneeBotId) ?? 0) < 20_000) return;
    this.lastTouch.set(assigneeBotId, now);
    const d = this.repo.findOpenForAssignee(assigneeBotId);
    if (d?.state === "working") {
      this.repo.update(d.id, { lastEventAt: this.now().toISOString() }, this.now());
    }
  }

  /** The assignee asked the human something on the requester's behalf: blocked, no wake needed. */
  async needsAnswer(assigneeBotId: string, message: string): Promise<Delegation | undefined> {
    const d = this.current(assigneeBotId);
    if (!d) return undefined;
    this.waits.set(d.id, (this.waits.get(d.id) ?? 0) + 1);
    const updated = this.repo.update(
      d.id,
      { state: "input_required", statusMessage: message, lastEventAt: this.now().toISOString() },
      this.now(),
    );
    if (updated) await this.announce(updated);
    return updated;
  }

  /** A card the assignee's running turn was parked on was answered. */
  async answered(assigneeBotId: string): Promise<Delegation | undefined> {
    const d = this.current(assigneeBotId);
    return d ? this.resume(d.id) : undefined;
  }

  /** The open, blocked delegation this Bot took on for this thread (a form's home). */
  openInThread(assigneeBotId: string, ownerThreadId: string): Delegation | undefined {
    return this.repo
      .list({ assigneeBotId, open: true })
      .find((d) => d.ownerThreadId === ownerThreadId && d.state === "input_required");
  }

  /** The human answered (or dismissed) one thing this task waited on; with none left, back to work. */
  async resume(id: string): Promise<Delegation | undefined> {
    const d = this.repo.getById(id);
    if (!d || d.state !== "input_required") return d;
    const left = Math.max(0, (this.waits.get(id) ?? 1) - 1);
    if (left > 0) {
      this.waits.set(id, left);
      return d;
    }
    this.waits.delete(id);
    const updated = this.repo.update(
      d.id,
      { state: "working", statusMessage: undefined, lastEventAt: this.now().toISOString() },
      this.now(),
    );
    if (updated) await this.announce(updated);
    return updated;
  }

  /**
   * `message_user` from a delegated assignee goes to its requester, not to the assignee's own
   * thread: a blocker or decision wakes the requester when the turn ends; a result is kept for the
   * final report. Returns the requester's id when it routed, or undefined for an undelegated Bot.
   */
  async report(
    assigneeBotId: string,
    kind: "result" | "decision" | "blocker",
    body: string,
  ): Promise<Delegation | undefined> {
    const d = this.current(assigneeBotId);
    if (!d) return undefined;
    const patch: Partial<Delegation> = { lastEventAt: this.now().toISOString() };
    if (kind === "result") {
      patch.result = clip(body);
    } else {
      patch.state = "input_required";
      patch.statusMessage = clip(body);
      patch.wakePending = true;
      patch.wakeKind = "blocked";
    }
    const updated = this.repo.update(d.id, patch, this.now());
    if (updated) await this.announce(updated);
    return updated;
  }

  /** A delegated turn ended: the harness settles the state and wakes the requester when owed. */
  async turnEnded(id: string, outcome: DelegatedTurnOutcome): Promise<void> {
    const d = this.repo.getById(id);
    if (!d) return;
    const left = Math.max(0, (this.pendingTurns.get(id) ?? 1) - 1);
    if (left > 0) this.pendingTurns.set(id, left);
    else this.pendingTurns.delete(id);
    if (!OPEN.has(d.state)) return;
    const now = this.now();
    if (left > 0) {
      // A follow-up is still queued for this task: it settles when that turn ends.
      this.repo.update(id, { lastEventAt: now.toISOString() }, now);
      return;
    }
    const stopped = outcome.status === "refused" && outcome.reason === "stopped";
    let patch: Partial<Delegation>;
    if (outcome.status === "completed") {
      if (d.state === "input_required") {
        // Waiting on the human (a form) or the requester (a blocker): not done. A blocker
        // already owes its wake.
        patch = { lastEventAt: now.toISOString() };
      } else {
        const text = outcome.synthesized && d.result ? undefined : outcome.text?.trim();
        patch = {
          state: "completed",
          result: text ? clip(text) : d.result,
          statusMessage: undefined,
          wakePending: true,
          wakeKind: "completed",
          lastEventAt: now.toISOString(),
        };
      }
    } else if (outcome.status === "interrupted" || stopped) {
      patch = {
        state: "interrupted",
        statusMessage: stopped
          ? "stopped by the user"
          : (outcome.reason ?? "stopped before it finished"),
        result: outcome.text?.trim() ? clip(outcome.text.trim()) : d.result,
        wakePending: true,
        wakeKind: stopped ? "stopped" : "interrupted",
        lastEventAt: now.toISOString(),
      };
    } else {
      patch = {
        state: "failed",
        statusMessage: outcome.reason ?? "the turn failed",
        wakePending: true,
        wakeKind: "failed",
        lastEventAt: now.toISOString(),
      };
    }
    const updated = this.repo.update(id, patch, now);
    if (!updated) return;
    await this.announce(updated);
    if (updated.wakePending) await this.deliverWake(updated.id);
  }

  /**
   * Shows the requester's user what happened (a card in the thread they are in) and wakes the
   * requester once. Safe to call twice: the wake is claimed atomically.
   */
  async deliverWake(id: string): Promise<void> {
    if (!this.repo.claimWake(id)) return;
    const d = this.repo.getById(id);
    if (!d) return;
    const worker = this.ctx.repos.bots.getById(d.assigneeBotId);
    const name = worker?.name ?? "A bot";
    const kind = d.wakeKind ?? d.state;
    const message: Message = {
      id: newId("message"),
      threadId: d.ownerThreadId,
      author: { type: "bot", id: d.assigneeBotId },
      text: cardText(name, d, kind),
      attachments: [],
      chainId: d.chainId,
      hop: 0,
      createdAt: this.now().toISOString(),
      proactive: false,
      kind: kind === "completed" ? "result" : "blocker",
      delivery: "delivered",
      pushed: false,
    };
    try {
      this.ctx.repos.messages.create(message);
    } catch (error) {
      // Nothing reached the user: keep the wake owed so a later pass delivers it.
      this.repo.update(id, { wakePending: true }, this.now());
      throw error;
    }
    await this.ctx.eventBus.publish({
      type: "message.created",
      botId: d.assigneeBotId,
      threadId: d.ownerThreadId,
      chainId: d.chainId,
      payload: { messageId: message.id, text: message.text, author: "bot", delegationId: d.id },
    });
    try {
      await this.onWake?.(d);
    } catch {
      // The card is already in front of the user; a failed wake turn must not undo that.
    }
  }

  /** After a restart: nothing that was running still is; deliver every wake that was owed. */
  async recover(): Promise<void> {
    this.bound.clear();
    this.pendingTurns.clear();
    this.waits.clear();
    for (const d of this.repo.list({ open: true })) {
      // Waiting on a form or a bot's own request survives a restart (the card is stored); a
      // permission card parked inside a turn does not: that turn is gone.
      const waitsOnStoredCard =
        d.state === "input_required" &&
        (this.ctx.repos.inputRequests
          .list({ status: "pending", botId: d.assigneeBotId })
          .some((r) => r.threadId === d.ownerThreadId) ||
          this.ctx.repos.approvals
            .list({ status: "pending" })
            .some((a) => a.botId === d.assigneeBotId && a.kind === "bot_request"));
      if (waitsOnStoredCard) {
        this.waits.set(d.id, 1);
        continue;
      }
      const updated = this.repo.update(
        d.id,
        {
          state: "interrupted",
          statusMessage: "OpenBot restarted before this finished",
          wakePending: true,
          wakeKind: "interrupted",
        },
        this.now(),
      );
      if (updated) await this.announce(updated);
    }
    for (const d of this.repo.listWakePending()) await this.deliverWake(d.id);
  }

  /** A working delegation with no engine activity for a while: tell the requester once. */
  async sweepStalled(): Promise<void> {
    const now = this.now();
    for (const d of this.repo.list({ open: true })) {
      if (d.state !== "working" || d.wakeKind === "stalled") continue;
      const idleMs = now.getTime() - new Date(d.lastEventAt).getTime();
      if (idleMs < STALL_AFTER_MS) continue;
      const updated = this.repo.update(
        d.id,
        {
          statusMessage: `no activity for ${Math.round(idleMs / 60_000)} minutes`,
          wakePending: true,
          wakeKind: "stalled",
        },
        now,
      );
      if (updated) {
        await this.announce(updated);
        await this.deliverWake(updated.id);
      }
    }
  }
}

const OPEN = new Set<string>(["submitted", "working", "input_required"]);

const trackers = new WeakMap<CoreContext, DelegationTracker>();

/** One tracker per context, so the MCP tools, routes and bootstrap share the same `onWake`. */
export function delegationsOf(ctx: CoreContext): DelegationTracker {
  let tracker = trackers.get(ctx);
  if (!tracker) {
    tracker = new DelegationTracker(ctx);
    trackers.set(ctx, tracker);
  }
  return tracker;
}

function titleOf(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 100 ? `${line.slice(0, 97)}...` : line || "Task";
}

function clip(text: string): string {
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n...` : text;
}

function cardText(name: string, d: Delegation, kind: string): string {
  const task = `"${d.title}"`;
  switch (kind) {
    case "completed":
      return `${name} finished ${task}.${d.result ? `\n\n${d.result}` : ""}`;
    case "blocked":
      return `${name} is blocked on ${task}: ${d.statusMessage ?? "it needs a decision"}`;
    case "stalled":
      return `${name} has shown no activity on ${task}: ${d.statusMessage ?? "it may be stuck"}.`;
    case "stopped":
      return `${name} was stopped on ${task}: the user stopped it.`;
    case "interrupted":
      return `${name} was interrupted on ${task}: ${d.statusMessage ?? "it stopped early"}.${d.result ? `\n\nWhat it had so far:\n${d.result}` : ""}`;
    default:
      return `${name} couldn't finish ${task}: ${d.statusMessage ?? "the turn failed"}.`;
  }
}
