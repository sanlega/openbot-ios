import { newId, type Bot } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";

/**
 * Creates the Chief of Staff once setup is complete and none exists yet. It is
 * the first Bot the user talks to and the one that spawns the rest, so a fresh
 * install needs it. Synchronous up to the event publish: callers that run it
 * from a bus subscriber leave the Bot in the store before `setup/complete`
 * returns to the UI.
 */
export function ensureChiefOfStaff(ctx: CoreContext): Bot | undefined {
  if (!ctx.repos.setupState.get().completedAt) return undefined;
  const existing = ctx.repos.bots
    .list({ includeHidden: true, includeArchived: true })
    .find((bot) => bot.isChiefOfStaff);
  if (existing) return undefined;

  const bot: Bot = {
    id: newId("bot"),
    slug: "chief-of-staff",
    name: "Chief of Staff",
    description:
      "Your first point of contact. Handles work itself and creates Bots only when needed.",
    pinned: true,
    hidden: false,
    isChiefOfStaff: true,
    createdBy: "user",
    routing: { mode: "auto" },
    permissionPreset: "full",
    computer: "docker",
    connectors: [],
    limits: {},
  };
  ctx.repos.bots.create(bot);
  ctx.repos.threads.create({
    id: newId("thread"),
    botId: bot.id,
    kind: "dm",
    createdAt: ctx.clock.now().toISOString(),
  });
  void ctx.eventBus.publish({ type: "bot.created", botId: bot.id, payload: { bot } });
  return bot;
}
