import {
  newId,
  type Bot,
  type InputField,
  type InputRequest,
  type Message,
} from "@openbot/contracts";
import { delegationsOf, getLogin, listLogins, saveLogin, type CoreContext } from "@openbot/core";
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
  "archive_bot",
  "ask_user",
  "cancel_input",
  "save_login",
  "request_approval",
  "computer_task",
  "computer_steer",
  "computer_cancel",
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
        `${toolName} is only available to the Chief of Staff`,
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
      case "ask_user":
        return this.askUser(
          session,
          parsed.data as { title: string; intro?: string; fields: InputField[] },
        );
      case "list_logins":
        return allowed({ logins: await listLogins(this.ctx.vault) });
      case "save_login": {
        const login = parsed.data as { site: string; username?: string; password?: string };
        // A Bot may add a login, never overwrite one: only the owner changes or removes them.
        if (await getLogin(this.ctx.vault, login.site)) {
          return refused(
            `a login for ${login.site} is already saved`,
            "ask the owner to change it in Settings > Computer > Saved logins",
          );
        }
        const saved = await saveLogin(this.ctx.vault, login.site, login, this.ctx.clock.now());
        return saved.ok ? allowed({ saved: true, site: saved.site }) : refused(saved.reason);
      }
      case "cancel_input":
        return this.cancelInput(session, (parsed.data as { request_id: string }).request_id);
      case "archive_bot":
        return this.archiveBot(
          session,
          parsed.data as { bot: string; reason: string; user_requested: boolean },
        );
      case "send_message":
        return this.services.runtime.sendMessage(session, parsed.data as never);
      case "message_user":
        return this.services.cos.messageUser(session, parsed.data as never);
      case "request_approval":
        return this.services.runtime.requestApproval(session, parsed.data as never);
      case "computer_task":
        return this.services.computer.computerTask(session, parsed.data as never);
      case "computer_status":
        return this.services.computer.computerStatus(session, parsed.data as never);
      case "computer_steer":
        return this.services.computer.computerSteer(session, parsed.data as never);
      case "computer_cancel":
        return this.services.computer.computerCancel(session, parsed.data as never);
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

  /**
   * Posts a form card and returns at once: the answers come back as a new user
   * turn (a parked engine turn would hold a CLI process for hours and time out).
   */
  private async askUser(
    session: SessionContext,
    input: { title: string; intro?: string; fields: InputField[] },
  ): Promise<ToolResult<{ request_id: string; status: "pending"; instruction: string }>> {
    const ids = new Set<string>();
    for (const field of input.fields) {
      if (ids.has(field.id)) return refused(`duplicate field id: ${field.id}`);
      ids.add(field.id);
    }
    const tracker = delegationsOf(this.ctx);
    // A delegated worker's form appears where the user is talking (the requester's thread), named
    // after the worker; its answer still goes back to the worker.
    const delegation = session.isChiefOfStaff ? undefined : tracker.current(session.botId);
    const thread = delegation
      ? this.ctx.repos.threads.getById(delegation.ownerThreadId)
      : this.ctx.repos.threads.getByBotId(session.botId);
    if (!thread) return refused(`no thread for bot ${session.botId}`);
    const asker = delegation ? this.ctx.repos.bots.getById(session.botId) : undefined;

    const now = this.ctx.clock.now().toISOString();
    const request: InputRequest = {
      id: newId("inputRequest"),
      botId: session.botId,
      threadId: thread.id,
      chainId: session.chainId,
      title: input.title,
      intro: input.intro,
      fields: input.fields,
      status: "pending",
      createdAt: now,
    };
    this.ctx.repos.inputRequests.create(request);
    const message: Message = {
      id: newId("message"),
      threadId: thread.id,
      author: { type: "bot", id: session.botId },
      text: `${asker ? `${asker.name} asks: ` : ""}${
        input.intro ? `${input.title}\n\n${input.intro}` : input.title
      }`,
      attachments: [],
      chainId: session.chainId,
      hop: 0,
      createdAt: now,
      proactive: false,
      delivery: "delivered",
      pushed: false,
      inputRequestId: request.id,
    };
    this.ctx.repos.messages.create(message);
    await this.ctx.eventBus.publish({
      type: "input.requested",
      botId: session.botId,
      threadId: thread.id,
      chainId: session.chainId,
      turnId: session.turnId,
      payload: { requestId: request.id, messageId: message.id, title: request.title, request },
    });
    await this.ctx.eventBus.publish({
      type: "message.created",
      botId: session.botId,
      threadId: thread.id,
      chainId: session.chainId,
      turnId: session.turnId,
      payload: {
        messageId: message.id,
        text: message.text,
        author: "bot",
        inputRequestId: request.id,
      },
    });
    if (delegation)
      await tracker.needsAnswer(session.botId, `waiting for the user: ${input.title}`);
    return allowed({
      request_id: request.id,
      status: "pending" as const,
      instruction:
        "The form is in front of the user. End your turn now; their answers arrive as their next message.",
    });
  }

  private async cancelInput(
    session: SessionContext,
    requestId: string,
  ): Promise<ToolResult<{ cancelled: boolean }>> {
    const request = this.ctx.repos.inputRequests.getById(requestId);
    if (!request || request.botId !== session.botId) return refused(`no such form: ${requestId}`);
    const cancelled = this.ctx.repos.inputRequests.resolve(
      requestId,
      "cancelled",
      this.ctx.clock.now(),
    );
    if (cancelled) {
      await this.ctx.eventBus.publish({
        type: "input.cancelled",
        botId: session.botId,
        threadId: request.threadId,
        payload: { requestId },
      });
    }
    return allowed({ cancelled });
  }

  private async archiveBot(
    session: SessionContext,
    input: { bot: string; reason: string; user_requested: boolean },
  ): Promise<ToolResult<{ archived: string }>> {
    const bot = this.findBot(input.bot);
    if (!bot) return refused(`bot not found: ${input.bot}`, "call list_bots for exact slugs");
    if (bot.isChiefOfStaff) return refused("the Chief of Staff cannot be archived");
    if (bot.archivedAt) return allowed({ archived: bot.slug });
    if (bot.createdBy === "user" && !input.user_requested) {
      return refused(
        "this bot was created by the user; archive it only when the user asks",
        "ask the user first",
      );
    }
    this.ctx.repos.bots.archive(bot.id, this.ctx.clock.now());
    await this.ctx.eventBus.publish({
      type: "bot.archived",
      botId: bot.id,
      chainId: session.chainId,
      payload: { botId: bot.id, by: session.botId, reason: input.reason },
    });
    return allowed({ archived: bot.slug });
  }

  private findBot(ref: string): Bot | undefined {
    const byKey = this.ctx.repos.bots.getById(ref) ?? this.ctx.repos.bots.getBySlug(ref);
    if (byKey) return byKey;
    const name = ref.trim().toLowerCase();
    const byName = this.ctx.repos.bots.list().filter((b) => b.name.toLowerCase() === name);
    return byName.length === 1 ? byName[0] : undefined;
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
      ...this.workStatus(bot),
    };
  }

  /** What the bot is doing for another bot, so a requester can check on it (never what it said). */
  private workStatus(bot: Bot): Record<string, unknown> {
    const open = delegationsOf(this.ctx).openFor(bot.id);
    return {
      ...(open
        ? {
            task: {
              id: open.id,
              title: open.title,
              state: open.state,
              statusMessage: open.statusMessage,
              askedBy: open.requesterBotId,
            },
          }
        : {}),
    };
  }
}

export function createToolRouter(ctx: CoreContext, services: McpToolServices): ToolRouter {
  return new ToolRouter(ctx, services);
}
