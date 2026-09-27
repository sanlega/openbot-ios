import type { Bot } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import type { McpToolServices } from "./services/interfaces.js";
import { TOOL_INPUT_SCHEMAS } from "./tool-schemas.js";
import { COS_ONLY_TOOLS } from "./tool-definitions.js";
import type { SessionContext, ToolResult } from "./types.js";
import { allowed, refused } from "./types.js";

/** OpenBot tools with an effect outside the calling turn; only simulated in a dry run. */
const SIDE_EFFECT_TOOLS = new Set([
  "send_message",
  "message_user",
  "create_bot",
  "request_approval",
  "computer_task",
  "create_routine",
  "update_routine",
  "run_routine",
]);

/** Of those, the ones whose service already returns a dry-run-shaped result without acting. */
const SIMULATES_ITSELF = new Set(["send_message", "message_user", "create_bot", "computer_task"]);

export class ToolRouter {
  constructor(
    private readonly ctx: CoreContext,
    private readonly services: McpToolServices,
  ) {}

  async dispatch(
    toolName: string,
    rawInput: unknown,
    session: SessionContext,
  ): Promise<ToolResult<Record<string, unknown>>> {
    if (COS_ONLY_TOOLS.has(toolName) && !session.isChiefOfStaff) {
      return refused(
        "create_bot is only available to the Chief of Staff",
        "delegate to the CoS or reuse an existing bot",
      );
    }

    const schema = TOOL_INPUT_SCHEMAS[toolName];
    if (!schema) {
      return refused(`unknown tool: ${toolName}`);
    }

    const parsed = schema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      return refused(`invalid input: ${parsed.error.message}`);
    }

    if (session.mode === "dry_run" && SIDE_EFFECT_TOOLS.has(toolName)) {
      // Dry runs (routine first runs) record what the Bot would do and never do it.
      await this.ctx.eventBus.publish({
        type: "action.simulated",
        botId: session.botId,
        chainId: session.chainId,
        turnId: session.turnId,
        payload: { kind: "tool", action: toolName, args: parsed.data as Record<string, unknown> },
      });
      if (!SIMULATES_ITSELF.has(toolName)) return allowed({ simulated: true });
    }

    switch (toolName) {
      case "list_bots":
        return this.listBots();
      case "get_bot_status":
        return this.getBotStatus(parsed.data as { bot: string });
      case "create_bot":
        return this.services.cos.createBot(session, parsed.data as never);
      case "send_message":
        return this.services.runtime.sendMessage(session, parsed.data as never);
      case "message_user":
        return this.services.cos.messageUser(session, parsed.data as never);
      case "request_approval":
        return this.services.runtime.requestApproval(session, parsed.data as never);
      case "computer_task":
        return this.services.computer.computerTask(session, parsed.data as never);
      case "computer_screenshot":
        return this.services.computer.computerScreenshot(session);
      case "create_routine":
        return this.services.routines.createRoutine(session, parsed.data as never);
      case "list_routines":
        return this.services.routines.listRoutines(session);
      case "update_routine":
        return this.services.routines.updateRoutine(session, parsed.data as never);
      case "run_routine":
        return this.services.routines.runRoutine(session, parsed.data as never);
      case "report_done":
        return this.services.runtime.reportDone(session, parsed.data as never);
      case "permission_prompt":
        return this.services.runtime.permissionPrompt(session, parsed.data as never);
      default:
        return refused(`tool not implemented: ${toolName}`);
    }
  }

  private listBots(): ToolResult<{ bots: Record<string, unknown>[] }> {
    const bots = this.ctx.repos.bots.list().map((bot: Bot) => this.botStatus(bot));
    return allowed({ bots });
  }

  private getBotStatus(input: { bot: string }): ToolResult<{ status: Record<string, unknown> }> {
    const bot = this.ctx.repos.bots.getById(input.bot) ?? this.ctx.repos.bots.getBySlug(input.bot);
    if (!bot) return refused(`bot not found: ${input.bot}`);
    return allowed({ status: this.botStatus(bot) });
  }

  private botStatus(bot: Bot): Record<string, unknown> {
    return {
      id: bot.id,
      slug: bot.slug,
      name: bot.name,
      isChiefOfStaff: bot.isChiefOfStaff,
      archived: Boolean(bot.archivedAt),
      lastActiveAt: bot.lastActiveAt,
      routing: bot.routing,
    };
  }
}

export function createToolRouter(ctx: CoreContext, services: McpToolServices): ToolRouter {
  return new ToolRouter(ctx, services);
}
