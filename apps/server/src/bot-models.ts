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

/** Every available engine's models, for the profile's model picker. */
export function modelLister(
  ctx: CoreContext,
  deps: TurnMailboxDeps,
  fetchClaudeModels: typeof listClaudeModelsForKey = listClaudeModelsForKey,
) {
  return async () => {
    const engines = (Object.keys(deps.drivers) as EngineId[]).filter((e) => deps.drivers[e]);
    return Promise.all(
      engines.map(async (engine): Promise<{ engine: EngineId; models: ModelInfo[] }> => {
        if (engine === "claude") {
          const apiKey =
            process.env.ANTHROPIC_API_KEY || (await ctx.vault.get(VAULT_KEYS.anthropic));
          if (apiKey) return { engine, models: (await fetchClaudeModels(apiKey)).models };
        }
        return { engine, models: (await deps.drivers[engine]?.listModels()) ?? [] };
      }),
    );
  };
}
