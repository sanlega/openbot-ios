import { newId, type Bot } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import { CapCounterService, NotifyGate, SpawnGate, justificationFromSpawn } from "@openbot/cos";
import type { Runtime } from "@openbot/runtime";
import type { CreateBotInput, MessageUserInput, SessionContext, ToolResult } from "../types.js";
import { allowed, refused } from "../types.js";
import type { McpCosService } from "./interfaces.js";

export interface McpCosServiceDeps {
  spawnGate: SpawnGate;
  notifyGate: NotifyGate;
  runtime: Runtime;
  caps: CapCounterService;
}

export class McpCosServiceAdapter implements McpCosService {
  constructor(
    private readonly ctx: CoreContext,
    private readonly deps: McpCosServiceDeps,
  ) {}

  async createBot(
    session: SessionContext,
    input: CreateBotInput,
  ): Promise<ToolResult<{ bot: Bot }>> {
    if (session.mode === "dry_run") {
      return allowed({ bot: previewBot(input), simulated: true } as { bot: Bot });
    }

    const roster = this.ctx.repos.bots.list();
    const cosCreated = roster.filter((b) => b.createdBy !== "user" && !b.archivedAt);

    const gateResult = await this.deps.spawnGate.evaluate({
      request: {
        name: input.name,
        description: input.description,
        responsibility: input.responsibility,
        whyNotExisting: input.why_not_existing,
        lifetime: input.lifetime,
        boundary: input.boundary,
        userRequested: input.user_requested,
      },
      roster,
      recentUserMessages: [],
      cosCreatedBotCount: cosCreated.length,
      spawnsInLast24h: this.deps.caps.spawnsInLast24h(),
      lastSpawnAt: this.deps.caps.lastSpawnAt(),
    });

    if (!gateResult.allowed) {
      return refused(gateResult.reason, gateResult.suggestion);
    }

    const bot: Bot = {
      id: newId("bot"),
      slug: slugify(input.name),
      name: input.name,
      description: input.description,
      pinned: false,
      hidden: false,
      isChiefOfStaff: false,
      createdBy: session.botId,
      routing: input.routing ?? { mode: "auto" },
      permissionPreset: input.preset ?? "workspace_write",
      computer: "none",
      connectors: [],
      limits: {},
      justification: justificationFromSpawn(
        {
          responsibility: input.responsibility,
          whyNotExisting: input.why_not_existing,
          lifetime: input.lifetime,
          boundary: input.boundary,
          userRequested: input.user_requested,
        },
        gateResult.decisionId,
      ),
    };

    this.ctx.repos.bots.create(bot);
    this.deps.caps.recordSpawn();
    this.ctx.repos.threads.create({
      id: newId("thread"),
      botId: bot.id,
      kind: "dm",
      createdAt: this.ctx.clock.now().toISOString(),
    });
    await this.ctx.eventBus.publish({ type: "bot.created", botId: bot.id, payload: { bot } });
    return allowed({ bot });
  }

  async messageUser(
    session: SessionContext,
    input: MessageUserInput,
  ): Promise<
    ToolResult<{ delivery: "delivered" | "held" | "merged"; pushed?: boolean; messageId?: string }>
  > {
    if (session.mode === "dry_run") {
      return allowed({
        delivery: "delivered" as const,
        pushed: input.kind === "blocker",
        messageId: newId("message"),
      });
    }

    const thread = this.ctx.repos.threads.getByBotId(session.botId);
    if (!thread) return refused("no thread for bot");

    const result = await this.deps.runtime.delivery.sendBotToUser({
      chainId: session.chainId,
      botId: session.botId,
      threadId: thread.id,
      kind: input.kind,
      text: input.body,
      options: input.options,
      deadline: input.deadline,
      dedupeKey: input.dedupe_key,
      mode: session.mode,
    });

    if (result.outcome === "refused") {
      return refused(result.reason ?? "message held");
    }

    const message = result.message;
    if (message && !this.ctx.repos.messages.getById(message.id)) {
      this.ctx.repos.messages.create(message);
    }

    return allowed({
      delivery: message?.delivery ?? "delivered",
      pushed: message?.pushed,
      messageId: message?.id ?? newId("message"),
    });
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function previewBot(input: CreateBotInput): Bot {
  return {
    id: newId("bot"),
    slug: slugify(input.name),
    name: input.name,
    description: input.description,
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "bot_cos",
    routing: input.routing ?? { mode: "auto" },
    permissionPreset: input.preset ?? "workspace_write",
    computer: "none",
    connectors: [],
    limits: {},
  };
}
