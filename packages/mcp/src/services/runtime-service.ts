import type { Bot } from "@openbot/contracts";
import { delegationsOf, type CoreContext } from "@openbot/core";
import { classifyToolCall, type Runtime } from "@openbot/runtime";
import type {
  ReportDoneInput,
  RequestApprovalInput,
  SendMessageInput,
  SessionContext,
  ToolResult,
} from "../types.js";
import { allowed, refused } from "../types.js";
import type { McpRuntimeService } from "./interfaces.js";

const OPENBOT_TOOL_PREFIX = "mcp__openbot__";

export class McpRuntimeServiceAdapter implements McpRuntimeService {
  constructor(
    private readonly ctx: CoreContext,
    private readonly runtime: Runtime,
  ) {}

  async sendMessage(
    session: SessionContext,
    input: SendMessageInput,
  ): Promise<ToolResult<{ queued: boolean }>> {
    if (session.mode === "dry_run") {
      return allowed({ queued: false, simulated: true } as { queued: boolean });
    }

    const target = this.resolveBot(input.bot);
    if (!target) return refused(`bot not found: ${input.bot}`);

    const toThread = this.ctx.repos.threads.getByBotId(target.id);
    if (!toThread) return refused(`no thread for bot ${target.id}`);

    if (target.id === session.botId) return refused("a bot cannot delegate to itself");
    const tracker = delegationsOf(this.ctx);
    const opened = tracker.open({
      requesterBotId: session.botId,
      assigneeBotId: target.id,
      chainId: session.chainId,
      text: input.text,
    });
    if (!opened.ok) return refused(opened.reason);
    const { delegation, continued } = opened;

    const result = await this.runtime.delivery.sendBotToBot({
      chainId: session.chainId,
      fromBotId: session.botId,
      toBotId: target.id,
      toThreadId: toThread.id,
      text: input.text,
      mode: session.mode,
      delegationId: delegation.id,
    });

    if (result.outcome === "refused") {
      if (!continued) tracker.abandon(delegation.id, result.reason ?? "delivery refused");
      return refused(result.reason ?? "delivery refused");
    }
    if (result.outcome === "simulated") {
      return allowed({ queued: false, simulated: true } as { queued: boolean });
    }
    return allowed({
      queued: true,
      delegation_id: delegation.id,
      continued,
      note: "Its result comes back to you on its own as a new message; do not poll or wait for it. End your turn once the user is informed.",
    } as { queued: boolean });
  }

  async requestApproval(
    session: SessionContext,
    input: RequestApprovalInput,
  ): Promise<ToolResult<{ approvalId: string }>> {
    const expiresAt = new Date(this.ctx.clock.now().getTime() + 30 * 60_000).toISOString();
    const approval = this.runtime.approvals.create({
      kind: "bot_request",
      botId: session.botId,
      chainId: session.chainId,
      summary: input.summary,
      detail: input.detail,
      expiresAt,
    });
    // The runtime approval store already persisted it (the repo-backed one writes the row).
    await this.ctx.eventBus.publish({
      type: "approval.requested",
      botId: session.botId,
      chainId: session.chainId,
      payload: {
        id: approval.id,
        approvalId: approval.id,
        kind: approval.kind,
        summary: approval.summary,
        detail: approval.detail,
        expiresAt: approval.expiresAt,
      },
    });
    // A delegated worker waits on the user, not on its requester: its task is blocked, not done.
    if (!session.isChiefOfStaff) {
      await delegationsOf(this.ctx).needsAnswer(
        session.botId,
        `waiting for the user's approval: ${input.summary}`,
      );
    }
    return allowed({
      approvalId: approval.id,
      instruction:
        "The approval card is in front of the user. End your turn now; you get their answer as your next message.",
    } as { approvalId: string });
  }

  async reportDone(
    session: SessionContext,
    input: ReportDoneInput,
  ): Promise<ToolResult<{ logged: boolean }>> {
    await this.ctx.eventBus.publish({
      type: "turn.completed",
      botId: session.botId,
      chainId: session.chainId,
      turnId: session.turnId,
      payload: { summary: input.summary, artifacts: input.artifacts },
    });
    return allowed({ logged: true });
  }

  async permissionPrompt(
    session: SessionContext,
    input: { tool_name: string; input: unknown },
  ): Promise<ToolResult<{ behavior: "allow" | "deny" }>> {
    // OpenBot's own tools are gated inside their handlers (spawn/notify gates,
    // caps, dry-run simulation), so an engine asking about them never needs the user.
    if (input.tool_name.startsWith(OPENBOT_TOOL_PREFIX)) {
      return allowed({ behavior: "allow" as const });
    }
    const decision = await this.runtime.broker.evaluate(
      {
        botId: session.botId,
        chainId: session.chainId,
        kind: "tool",
        action: input.tool_name,
        args: (input.input ?? {}) as Record<string, unknown>,
        computerAccess:
          this.ctx.repos.bots.getById(session.botId)?.computer ?? session.bot.computer,
        ...classifyToolCall(input.tool_name, input.input, this.ctx.config.workspaceDir),
        summary: `Permission prompt: ${input.tool_name}`,
        detail: JSON.stringify(input.input ?? {}),
        // A connector tool: writes the catalogue marks (or does not know) need a card.
        ...this.ctx.connectorService?.classifyTool(session.botId, input.tool_name, input.input),
      },
      {
        mode: session.mode,
        // The Bot as it is now: a preset changed mid-turn applies to the very next action.
        preset:
          this.ctx.repos.bots.getById(session.botId)?.permissionPreset ??
          session.bot.permissionPreset,
      },
    );
    if (decision.outcome === "allow") {
      return allowed({ behavior: "allow" as const });
    }
    if (decision.outcome === "simulate") {
      // Dry run: the broker recorded the action; the engine must not perform it.
      return allowed({ behavior: "deny" as const });
    }
    if (decision.outcome === "ask" && decision.approvalId) {
      // The engine is blocked on this tool call until the user answers the card
      // (or it expires, which denies).
      const resolution = await this.runtime.broker.waitForApproval(decision.approvalId);
      return allowed({ behavior: resolution });
    }
    return allowed({ behavior: "deny" as const });
  }

  private resolveBot(ref: string): Bot | undefined {
    const byKey = this.ctx.repos.bots.getById(ref) ?? this.ctx.repos.bots.getBySlug(ref);
    if (byKey) return byKey;
    // Engines often address a Bot by the name the user sees.
    const name = ref.trim().toLowerCase();
    const byName = this.ctx.repos.bots.list().filter((b) => b.name.toLowerCase() === name);
    return byName.length === 1 ? byName[0] : undefined;
  }
}
