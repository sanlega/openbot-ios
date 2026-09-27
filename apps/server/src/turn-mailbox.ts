import type { Bot, ChainMode, EngineDriver, EngineId, TurnInput } from "@openbot/contracts";
import type { CoreContext, TurnMailbox } from "@openbot/core";
import { buildCosSystemPrompt, type AutonomyCaps, type CapCounterService } from "@openbot/cos";
import { McpComposer, type SessionTokenService } from "@openbot/mcp";
import {
  COMPUTER_RULE_BLOCK,
  NON_COS_RULE_BLOCK,
  type EnqueueTurnInput,
  type Runtime,
  type SessionStore,
} from "@openbot/runtime";
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

export interface BuildTurnArgs {
  bot: Bot;
  text: string;
  chainId: string;
  threadId: string;
  mode: ChainMode;
  /** Explicit engine override (the route chip); otherwise the Bot's pin or Jev's route. */
  engine?: EngineId;
}

export type TurnBuilder = (args: BuildTurnArgs) => Promise<EnqueueTurnInput | { error: string }>;

/**
 * Everything one engine turn needs, shared by chat (`message.send`) and routine
 * runs: engine and model (override, pin, or Jev's route), auth (vault key or
 * CLI login), the CoS prompt, and the OpenBot MCP server with a session token
 * bound to the turn (and to the chain's mode, so dry runs only simulate).
 */
export type EngineChooser = (
  bot: Bot,
  text: string,
  requested?: EngineId,
) => Promise<EngineChoice | { error: string }>;

/** Engine and model for a Bot: an explicit override, the Bot's pin, or Jev's route. */
export function createEngineChooser(ctx: CoreContext, deps: TurnMailboxDeps): EngineChooser {
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

  return chooseEngine;
}

export function createTurnBuilder(ctx: CoreContext, deps: TurnMailboxDeps): TurnBuilder {
  const chooseEngine = createEngineChooser(ctx, deps);

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
    const computer = bot.computer !== "none" ? `\n\n${COMPUTER_RULE_BLOCK}` : "";
    if (!bot.isChiefOfStaff) return `${bot.description}\n\n${NON_COS_RULE_BLOCK}${computer}`;
    const roster = ctx.repos.bots.list();
    return `${bot.description}\n\n${buildCosSystemPrompt({
      userName: "the user",
      roster,
      caps: deps.autonomyCaps,
      cosCreatedBotCount: roster.filter((b) => b.createdBy !== "user" && !b.archivedAt).length,
      spawnsLeftToday: Math.max(0, deps.autonomyCaps.newBotsPerDay - deps.caps.spawnsInLast24h()),
    })}${computer}`;
  }

  return async ({ bot, text, chainId, threadId, mode, engine }) => {
    const choice = await chooseEngine(bot, text, engine);
    if ("error" in choice) return { error: choice.error };
    return {
      bot,
      text,
      attachments: [],
      systemPrompt: systemPromptFor(bot),
      cwd: ctx.config.workspaceDir,
      addDirs: [],
      auth: await authFor(bot, choice.engine),
      mcpServers: [],
      permission: bot.permissionPreset,
      // OpenBot's own tools carry their own gates (spawn/notify gates, caps S1–S10,
      // dry-run simulation); the engine must not ask the user about them.
      allowTools: ["mcp__openbot"],
      denyTools: [],
      model: choice.model,
      effort: choice.effort,
      limits: { maxSteps: 50 },
      engine: choice.engine,
      chainId,
      threadId,
      // Connector tools (engine approval hooks): catalogue writes are side effects.
      classifyApproval: (r) =>
        ctx.connectorService?.classifyTool(bot.id, r.toolName, r.input) ?? {},
      prepareTurn: async (turnId) => {
        const mcp = deps.mcp();
        if (!mcp) throw new Error("OpenBot MCP tools are not ready yet");
        // Composing tools must never hold the Bot's queue: give up after 30 s.
        const { servers } = await withTimeout(
          McpComposer.forTurnAsync(mcp.tokens, {
            bot,
            turnId,
            chainId,
            mode,
            harnessUrl: `http://127.0.0.1:${ctx.config.port}`,
            connectors: mcp.connectors,
          }),
          30_000,
          "preparing this bot's tools took too long",
        );
        return { mcpServers: servers };
      },
    };
  };
}

/**
 * The Client API's `message.send` → one engine turn (plan §4.7, M1): stores the
 * user's message in the Bot's thread and hands the turn built by
 * {@link createTurnBuilder} to the runtime mailbox, which stores the reply.
 */
export function createTurnMailbox(
  ctx: CoreContext,
  deps: TurnMailboxDeps,
  buildTurn: TurnBuilder = createTurnBuilder(ctx, deps),
): TurnMailbox {
  return {
    enqueue: async (input) => {
      const bot = ctx.repos.bots.getById(input.botId);
      if (!bot) return { ok: false, reason: `unknown bot ${input.botId}` };
      const thread = ctx.repos.threads.getByBotId(bot.id);
      if (!thread || (input.threadId && input.threadId !== thread.id)) {
        return { ok: false, reason: `thread does not belong to bot ${bot.id}` };
      }

      let chainId = input.chainId;
      const chain = chainId ? ctx.repos.chains.getById(chainId) : undefined;
      if (!chain) {
        // The runtime's chain store is repo-backed, so this also persists it.
        chainId = deps.runtime.chains.create({ origin: "user", mode: "live" }).id;
      }
      const liveChainId = chainId!;
      const mode = ctx.repos.chains.getById(liveChainId)?.mode ?? "live";

      const turn = await buildTurn({
        bot,
        text: input.text,
        chainId: liveChainId,
        threadId: thread.id,
        mode,
        engine: input.engine,
      });
      if ("error" in turn) return { ok: false, reason: turn.error };

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

      void deps.runtime.mailbox.submit(turn);
      return {
        ok: true,
        chainId: liveChainId,
        messageId: userMessage.id,
        engine: turn.engine,
        model: turn.model,
      };
    },
    stop: async (turnId: string) => {
      const turn = ctx.repos.turns.getById(turnId);
      if (!turn) return { ok: false, reason: "turn not found" };
      await deps.runtime.mailbox.stop(turn.botId);
      return { ok: true };
    },
    stopBot: async (botId: string) => {
      if (!ctx.repos.bots.getById(botId)) return { ok: false, reason: "bot not found" };
      await deps.runtime.mailbox.stop(botId);
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

/**
 * A message from another Bot (`send_message`) is a task for the recipient: run
 * its turn on the same chain, so hop limits and loop guards keep applying. The
 * message itself is already in the recipient's thread (runtime delivery).
 */
export function wakeOnBotMessages(
  ctx: CoreContext,
  deps: TurnMailboxDeps,
  buildTurn: TurnBuilder,
): () => void {
  return ctx.eventBus.subscribe((event) => {
    if (event.type !== "handoff.sent" || !event.chainId) return;
    const toBotId = event.payload.toBotId;
    const messageId = event.payload.messageId;
    if (typeof toBotId !== "string" || typeof messageId !== "string") return;
    const chainId = event.chainId;
    void (async () => {
      const bot = ctx.repos.bots.getById(toBotId);
      const thread = bot ? ctx.repos.threads.getByBotId(bot.id) : undefined;
      const message = ctx.repos.messages.getById(messageId);
      if (!bot || !thread || !message) return;
      const from = event.botId ? ctx.repos.bots.getById(event.botId) : undefined;
      const turn = await buildTurn({
        bot,
        text: `Message from ${from?.name ?? "another Bot"} (bot "${from?.slug ?? event.botId}"):\n\n${message.text}`,
        chainId,
        threadId: thread.id,
        mode: ctx.repos.chains.getById(chainId)?.mode ?? "live",
      });
      if ("error" in turn) {
        await ctx.eventBus.publish({
          type: "turn.failed",
          botId: bot.id,
          threadId: thread.id,
          chainId,
          payload: { text: "", errorMessage: turn.error },
        });
        return;
      }
      void deps.runtime.mailbox.submit(turn);
    })().catch(() => undefined);
  });
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

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
