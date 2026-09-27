import type { Bot, EngineDriver, EngineId, TurnInput } from "@openbot/contracts";
import type { CoreContext, TurnMailbox } from "@openbot/core";
import { buildCosSystemPrompt, type AutonomyCaps, type CapCounterService } from "@openbot/cos";
import { McpComposer, type SessionTokenService } from "@openbot/mcp";
import type { Runtime, SessionStore } from "@openbot/runtime";
import { VAULT_KEYS } from "./providers.js";

type McpConnectors = Parameters<typeof McpComposer.forTurnAsync>[1]["connectors"];

export interface TurnMailboxDeps {
  runtime: Runtime;
  drivers: Partial<Record<EngineId, EngineDriver>>;
  autonomyCaps: AutonomyCaps;
  caps: CapCounterService;
  /** Available once `integrateMcp` has run; turns fail cleanly before that. */
  mcp: () => { tokens: SessionTokenService; connectors?: McpConnectors } | undefined;
}

interface EngineChoice {
  engine: EngineId;
  model: string;
  effort?: TurnInput["effort"];
  routeDecisionId?: string;
}

/**
 * The Client API's `message.send` → one engine turn (plan §4.7, M1): stores the
 * user's message in the Bot's thread, picks the engine and model (an explicit
 * override, the Bot's pin, or Jev's route), resumes the Bot's engine session,
 * injects the OpenBot MCP server with a per-turn session token, and hands the
 * turn to the runtime mailbox, which stores the Bot's reply.
 */
export function createTurnMailbox(ctx: CoreContext, deps: TurnMailboxDeps): TurnMailbox {
  const modelCache = new Map<EngineId, string[]>();

  async function modelsFor(engine: EngineId): Promise<string[]> {
    const cached = modelCache.get(engine);
    if (cached) return cached;
    const models = ((await deps.drivers[engine]?.listModels()) ?? []).map((m) => m.id);
    modelCache.set(engine, models);
    return models;
  }

  async function defaultModel(engine: EngineId, preferred?: string): Promise<string> {
    if (preferred) return preferred;
    return (await modelsFor(engine))[0] ?? "default";
  }

  async function chooseEngine(
    bot: Bot,
    text: string,
    requested?: EngineId,
  ): Promise<EngineChoice | { error: string }> {
    const available = (Object.keys(deps.drivers) as EngineId[]).filter((e) => deps.drivers[e]);
    if (available.length === 0) {
      return { error: "no engine available: log in to Claude Code or Codex, or add an API key" };
    }

    const pinnedEngine = bot.routing.mode === "pinned" ? bot.routing.engine : undefined;
    const override = requested ?? pinnedEngine;
    if (override) {
      if (!deps.drivers[override]) return { error: `engine "${override}" is not available` };
      const model = bot.routing.engine === override ? bot.routing.model : undefined;
      return {
        engine: override,
        model: await defaultModel(override, model),
        effort: bot.routing.effort,
      };
    }

    if (!ctx.decisionService) {
      const engine = available[0]!;
      return { engine, model: await defaultModel(engine) };
    }
    const modelsCatalog: Record<string, string[]> = {};
    for (const engine of available) modelsCatalog[engine] = await modelsFor(engine);
    const route = await ctx.decisionService.route(bot, text, {
      availableEngines: available,
      modelsCatalog,
    });
    const engine = deps.drivers[route.engine] ? route.engine : available[0]!;
    const model =
      engine === route.engine && (modelsCatalog[engine] ?? []).includes(route.model)
        ? route.model
        : await defaultModel(engine);
    return { engine, model, effort: route.effort, routeDecisionId: route.decisionId };
  }

  async function authFor(bot: Bot, engine: EngineId): Promise<TurnInput["auth"]> {
    if (engine !== "claude" && engine !== "codex") return { mode: "login", env: {} };
    const vaultKey = engine === "claude" ? VAULT_KEYS.anthropic : VAULT_KEYS.openai;
    const envName = engine === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    const key = await ctx.vault.get(vaultKey);
    const mode = bot.auth?.[engine] ?? (key ? "api_key" : "login");
    return mode === "api_key" && key
      ? { mode, env: { [envName]: key } }
      : { mode: "login", env: {} };
  }

  function systemPromptFor(bot: Bot): string {
    if (!bot.isChiefOfStaff) return bot.description;
    const roster = ctx.repos.bots.list();
    return `${bot.description}\n\n${buildCosSystemPrompt({
      userName: "the user",
      roster,
      caps: deps.autonomyCaps,
      cosCreatedBotCount: roster.filter((b) => b.createdBy !== "user" && !b.archivedAt).length,
      spawnsLeftToday: Math.max(0, deps.autonomyCaps.newBotsPerDay - deps.caps.spawnsInLast24h()),
    })}`;
  }

  return {
    enqueue: async (input) => {
      const bot = ctx.repos.bots.getById(input.botId);
      if (!bot) return { ok: false, reason: `unknown bot ${input.botId}` };
      const thread = ctx.repos.threads.getByBotId(bot.id);
      if (!thread || (input.threadId && input.threadId !== thread.id)) {
        return { ok: false, reason: `thread does not belong to bot ${bot.id}` };
      }

      const choice = await chooseEngine(bot, input.text, input.engine);
      if ("error" in choice) return { ok: false, reason: choice.error };

      let chainId = input.chainId;
      const chain = chainId ? ctx.repos.chains.getById(chainId) : undefined;
      if (!chain) {
        // The runtime's chain store is repo-backed, so this also persists it.
        chainId = deps.runtime.chains.create({ origin: "user", mode: "live" }).id;
      }
      const liveChainId = chainId!;

      const userMessage = deps.runtime.messages.create({
        threadId: thread.id,
        author: { type: "user", id: "user" },
        text: input.text,
        attachments: [],
        chainId: liveChainId,
        hop: 0,
        proactive: false,
        delivery: "delivered",
        pushed: false,
      });
      await ctx.eventBus.publish({
        type: "message.created",
        botId: bot.id,
        threadId: thread.id,
        chainId: liveChainId,
        payload: { messageId: userMessage.id, text: input.text, author: "user" },
      });

      const mode = ctx.repos.chains.getById(liveChainId)?.mode ?? "live";
      void deps.runtime.mailbox.submit({
        bot,
        text: input.text,
        attachments: [],
        systemPrompt: systemPromptFor(bot),
        cwd: ctx.config.workspaceDir,
        addDirs: [],
        auth: await authFor(bot, choice.engine),
        mcpServers: [],
        permission: bot.permissionPreset,
        allowTools: [],
        denyTools: [],
        model: choice.model,
        effort: choice.effort,
        limits: { maxSteps: 50 },
        engine: choice.engine,
        chainId: liveChainId,
        threadId: thread.id,
        prepareTurn: async (turnId) => {
          const mcp = deps.mcp();
          if (!mcp) throw new Error("OpenBot MCP tools are not ready yet");
          const { servers } = await McpComposer.forTurnAsync(mcp.tokens, {
            bot,
            turnId,
            chainId: liveChainId,
            mode,
            harnessUrl: `http://127.0.0.1:${ctx.config.port}`,
            connectors: mcp.connectors,
          });
          return { mcpServers: servers };
        },
      });
      return {
        ok: true,
        chainId: liveChainId,
        messageId: userMessage.id,
        engine: choice.engine,
        model: choice.model,
      };
    },
    stop: async (turnId: string) => {
      const turn = ctx.repos.turns.getById(turnId);
      if (!turn) return { ok: false, reason: "turn not found" };
      await deps.runtime.mailbox.stop(turn.botId);
      return { ok: true };
    },
    steer: async (turnId: string, text: string) => {
      const turn = ctx.repos.turns.getById(turnId);
      if (!turn) return { ok: false, reason: "turn not found" };
      try {
        await deps.runtime.mailbox.steer(turn.botId, text);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: String(error) };
      }
    },
  };
}

/** `engine_sessions`-backed store, so a Bot resumes its engine session after a restart (M1). */
export class RepoSessionStore implements SessionStore {
  constructor(private readonly ctx: CoreContext) {}

  get(botId: string, engine: EngineId): string | undefined {
    return this.ctx.repos.engineSessions.getForBotAndEngine(botId, engine)?.sessionId;
  }

  set(botId: string, engine: EngineId, sessionId: string): void {
    this.ctx.repos.engineSessions.upsert({
      id: `${botId}:${engine}`,
      botId,
      engine,
      sessionId,
      at: this.ctx.clock.now(),
    });
  }

  clear(botId: string, engine: EngineId): void {
    this.ctx.repos.engineSessions.deleteForBotAndEngine(botId, engine);
  }
}
