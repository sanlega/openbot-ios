import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCoreContext, loadConfig, type CoreContext } from "@openbot/core";
import { FakeClock } from "@openbot/testkit";
import type { Settings } from "@openbot/contracts";
import { upgradeUntouchedSpawnCaps } from "./bootstrap.js";

let ctx: CoreContext | undefined;
let home: string | undefined;

afterEach(async () => {
  ctx?.closeDb();
  if (home) await rm(home, { recursive: true, force: true });
  ctx = undefined;
  home = undefined;
});

async function setup(caps: Partial<Settings["caps"]>) {
  home = await mkdtemp(join(tmpdir(), "openbot-caps-"));
  ctx = await createCoreContext({
    clock: new FakeClock(new Date("2026-09-30T10:00:00Z")),
    config: loadConfig({ env: { OPENBOT_HOME: home }, overrides: { dbPath: ":memory:" } }),
    disableNdjson: true,
  });
  ctx.repos.settings.upsert({
    id: "singleton",
    caps: {
      s1_cosBotsCap: 6,
      s2_newBotsPer24h: 2,
      s3_spawnCooldownMin: 30,
      s4_proactivePerBotPerHour: 3,
      s4_proactivePerBotPerDay: 8,
      s5_proactiveAllBotsPerHour: 6,
      s6_dedupeWindowHours: 6,
      s10_mergeWindowMin: 10,
      ...caps,
    },
    budgets: { gates: 250, interactive: 200, computer: 450, background: 100 },
    updatedAt: "2026-09-01T00:00:00Z",
  } as Settings);
  return ctx;
}

describe("upgradeUntouchedSpawnCaps", () => {
  it("moves the untouched old defaults (6 / 2 / 30) to the new ones", async () => {
    const core = await setup({});
    upgradeUntouchedSpawnCaps(core);
    expect(core.repos.settings.get()?.caps).toMatchObject({
      s1_cosBotsCap: 10,
      s2_newBotsPer24h: 8,
      s3_spawnCooldownMin: 2,
    });
  });

  it("keeps limits the owner changed", async () => {
    const core = await setup({ s2_newBotsPer24h: 3 });
    upgradeUntouchedSpawnCaps(core);
    expect(core.repos.settings.get()?.caps).toMatchObject({
      s1_cosBotsCap: 6,
      s2_newBotsPer24h: 3,
      s3_spawnCooldownMin: 30,
    });
  });
});
