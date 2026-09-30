import type { Bot, EngineId, ModelInfo } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import { listClaudeModelsForKey } from "@openbot/engines-claude";
import type { EngineChooser, TurnMailboxDeps } from "./turn-mailbox.js";
import { VAULT_KEYS } from "./providers.js";

/**
 * When the CoS creates a Bot, Jev picks its engine and model once, from what the
 * Bot is for, and the Bot keeps it (shown and editable in its profile). The user
 * can switch it back to "auto" to let Jev route every turn.
 */
export function pinModelOnSpawn(ctx: CoreContext, chooseEngine: EngineChooser): () => void {
  return ctx.eventBus.subscribe((event) => {
    if (event.type !== "bot.created" || !event.botId) return;
    const botId = event.botId;
    void (async () => {
      const bot = ctx.repos.bots.getById(botId);
      if (!bot || bot.createdBy === "user" || bot.routing.mode !== "auto") return;
      const task = [bot.description, bot.justification?.responsibility].filter(Boolean).join("\n");
      const choice = await chooseEngine(bot, task);
      if ("error" in choice) return;
      const routing: Bot["routing"] = {
        mode: "pinned",
        engine: choice.engine,
        model: choice.model,
        effort: choice.effort,
      };
      ctx.repos.bots.update(bot.id, { routing });
      await ctx.eventBus.publish({
        type: "bot.updated",
        botId: bot.id,
        payload: { patch: { routing }, bot: ctx.repos.bots.getById(bot.id) },
      });
    })().catch(() => undefined);
  });
}

/** How long a model list is served without asking the engine again. */
export const MODEL_LIST_FRESH_MS = 60_000;

/**
 * Every available engine's models, for the profile's model picker. Some engines are slow to
 * list (OpenCode runs a CLI and probes local model servers), so each engine's last list is
 * served at once and refreshed in the background once it is older than a minute; a failed
 * refresh keeps the previous list.
 */
export function modelLister(
  ctx: CoreContext,
  deps: TurnMailboxDeps,
  fetchClaudeModels: typeof listClaudeModelsForKey = listClaudeModelsForKey,
  now: () => number = Date.now,
) {
  const cache = new Map<EngineId, { at: number; models: ModelInfo[] }>();
  const pending = new Map<EngineId, Promise<ModelInfo[]>>();

  const fetchEngine = async (engine: EngineId): Promise<ModelInfo[]> => {
    if (engine === "claude") {
      const apiKey = process.env.ANTHROPIC_API_KEY || (await ctx.vault.get(VAULT_KEYS.anthropic));
      if (apiKey) return (await fetchClaudeModels(apiKey)).models;
    }
    return (await deps.drivers[engine]?.listModels()) ?? [];
  };

  const refresh = (engine: EngineId): Promise<ModelInfo[]> => {
    const running = pending.get(engine);
    if (running) return running;
    const task = fetchEngine(engine)
      .then((models) => {
        cache.set(engine, { at: now(), models });
        return models;
      })
      .catch(() => cache.get(engine)?.models ?? [])
      .finally(() => pending.delete(engine));
    pending.set(engine, task);
    return task;
  };

  return async () => {
    const engines = (Object.keys(deps.drivers) as EngineId[]).filter((e) => deps.drivers[e]);
    return Promise.all(
      engines.map(async (engine): Promise<{ engine: EngineId; models: ModelInfo[] }> => {
        const cached = cache.get(engine);
        if (!cached) return { engine, models: await refresh(engine) };
        if (now() - cached.at > MODEL_LIST_FRESH_MS) void refresh(engine);
        return { engine, models: cached.models };
      }),
    );
  };
}
