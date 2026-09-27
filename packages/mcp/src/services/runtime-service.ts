import type { Bot } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import type { Runtime } from "@openbot/runtime";
import type {
  ReportDoneInput,
  RequestApprovalInput,
  SendMessageInput,
  SessionContext,
  ToolResult,
} from "../types.js";
import { allowed, refused } from "../types.js";
import type { McpRuntimeService } from "./interfaces.js";

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

    const result = await this.runtime.delivery.sendBotToBot({
      chainId: session.chainId,
      fromBotId: session.botId,
      toBotId: target.id,
      toThreadId: toThread.id,
      text: input.text,
      mode: session.mode,
    });

    if (result.outcome === "refused") {
      return refused(result.reason ?? "delivery refused");
    }
    if (result.outcome === "simulated") {
      return allowed({ queued: false, simulated: true } as { queued: boolean });
    }
    return allowed({ queued: true });
  }

  async requestApproval(
    session: SessionContext,
    input: RequestApprovalInput,
  ): Promise<ToolResult<{ approvalId: string }>> {
    const expiresAt = new Date(this.ctx.clock.now().getTime() + 30 * 60_000).toISOString();
    const approval = this.runtime.approvals.create({
      kind: "tool",
      botId: session.botId,
      chainId: session.chainId,
      summary: input.summary,
      detail: input.detail,
      expiresAt,
    });
    this.ctx.repos.approvals.create(approval);
    await this.ctx.eventBus.publish({
      type: "approval.requested",
      botId: session.botId,
      chainId: session.chainId,
      payload: { id: approval.id, kind: approval.kind },
    });
    return allowed({ approvalId: approval.id });
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
    const decision = await this.runtime.broker.evaluate(
      {
        botId: session.botId,
        chainId: session.chainId,
        kind: "tool",
        action: input.tool_name,
        args: (input.input ?? {}) as Record<string, unknown>,
        summary: `Permission prompt: ${input.tool_name}`,
        detail: JSON.stringify(input.input ?? {}),
      },
      { mode: session.mode, preset: session.bot.permissionPreset },
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
    return this.ctx.repos.bots.getById(ref) ?? this.ctx.repos.bots.getBySlug(ref);
  }
}
