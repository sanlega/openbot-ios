import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newId, type Bot } from "@openbot/contracts";
import { createCoreContext, loadConfig, type CoreContext } from "@openbot/core";
import { FakeClock } from "@openbot/testkit";
import { pinModelOnSpawn } from "./bot-models.js";

let ctx: CoreContext | undefined;
let home: string | undefined;

afterEach(async () => {
  ctx?.closeDb();
  if (home) await rm(home, { recursive: true, force: true });
  ctx = undefined;
  home = undefined;
});

function bot(overrides: Partial<Bot>): Bot {
  return {
    id: newId("bot"),
    slug: `b-${Math.random().toString(36).slice(2, 7)}`,
    name: "Bot",
    description: "researches business ideas",
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "bot_cos",
    routing: { mode: "auto" },
    permissionPreset: "workspace_write",
    computer: "none",
    connectors: [],
    limits: {},
    ...overrides,
  };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
}

describe("pinModelOnSpawn", () => {
  it("pins the model Jev picks for a CoS-created Bot, and leaves user-created Bots alone", async () => {
    home = await mkdtemp(join(tmpdir(), "openbot-models-"));
    ctx = await createCoreContext({
      clock: new FakeClock(new Date("2026-09-27T10:00:00Z")),
      config: loadConfig({ env: { OPENBOT_HOME: home }, overrides: { dbPath: ":memory:" } }),
      disableNdjson: true,
    });
    const core = ctx;
    const tasks: string[] = [];
    pinModelOnSpawn(core, async (_bot, task) => {
      tasks.push(task);
      return { engine: "claude", model: "claude-sonnet-5", effort: "medium" };
    });

    const spawned = bot({});
    const mine = bot({ createdBy: "user" });
    for (const b of [spawned, mine]) {
      core.repos.bots.create(b);
      await core.eventBus.publish({ type: "bot.created", botId: b.id, payload: { bot: b } });
    }

    await waitFor(() => core.repos.bots.getById(spawned.id)?.routing.mode === "pinned");
    expect(core.repos.bots.getById(spawned.id)?.routing).toEqual({
      mode: "pinned",
      engine: "claude",
      model: "claude-sonnet-5",
      effort: "medium",
    });
    expect(tasks).toEqual(["researches business ideas"]);
    expect(core.repos.bots.getById(mine.id)?.routing).toEqual({ mode: "auto" });
  });
});
