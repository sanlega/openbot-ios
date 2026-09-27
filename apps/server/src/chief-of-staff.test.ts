import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCoreContext, loadConfig, type CoreContext } from "@openbot/core";
import { FakeClock } from "@openbot/testkit";
import { ensureChiefOfStaff } from "./chief-of-staff.js";

let ctx: CoreContext | undefined;
let home: string | undefined;

afterEach(async () => {
  ctx?.closeDb();
  if (home) await rm(home, { recursive: true, force: true });
  ctx = undefined;
  home = undefined;
});

async function setup() {
  home = await mkdtemp(join(tmpdir(), "openbot-cos-"));
  ctx = await createCoreContext({
    clock: new FakeClock(new Date("2026-09-27T10:00:00Z")),
    config: loadConfig({ env: { OPENBOT_HOME: home }, overrides: { dbPath: ":memory:" } }),
    disableNdjson: true,
  });
  return ctx;
}

const allBots = (core: CoreContext) =>
  core.repos.bots.list({ includeHidden: true, includeArchived: true });

describe("ensureChiefOfStaff", () => {
  it("does nothing before setup is complete", async () => {
    const core = await setup();
    expect(ensureChiefOfStaff(core)).toBeUndefined();
    expect(allBots(core)).toHaveLength(0);
  });

  it("creates one CoS with a DM thread once setup is complete, and only once", async () => {
    const core = await setup();
    core.repos.setupState.patch({ completedAt: core.clock.now().toISOString() });

    const cos = ensureChiefOfStaff(core);
    expect(cos).toMatchObject({ isChiefOfStaff: true, name: "Chief of Staff" });
    expect(core.repos.threads.list().filter((t) => t.botId === cos?.id)).toHaveLength(1);

    expect(ensureChiefOfStaff(core)).toBeUndefined();
    expect(allBots(core).filter((b) => b.isChiefOfStaff)).toHaveLength(1);
  });
});
