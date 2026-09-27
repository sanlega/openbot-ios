import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newId } from "@openbot/contracts";
import { FakeClock } from "@openbot/testkit";
import { createCoreContext, type CoreContext } from "./context.js";

/**
 * WS1 acceptance: "state survives a restart." Boots a context against a
 * real on-disk DB + vault + device-secret (no `:memory:`, no
 * `InMemoryVault`), writes data, fully closes it (as `serve` would on
 * shutdown), then boots a brand-new context against the same
 * `OPENBOT_HOME` (as `serve` would on the next launch) and checks every
 * piece of state — bot rows, the event log, and the device-auth signing
 * secret — is exactly as it was left.
 */
describe("state survives a restart", () => {
  let openbotHome: string;
  let contexts: CoreContext[] = [];

  afterEach(async () => {
    for (const ctx of contexts) ctx.closeDb();
    contexts = [];
    if (openbotHome) await rm(openbotHome, { recursive: true, force: true });
  });

  async function bootContext(): Promise<CoreContext> {
    const ctx = await createCoreContext({
      clock: new FakeClock(new Date("2026-01-01T00:00:00.000Z")),
      config: {
        openbotHome,
        dbPath: join(openbotHome, "openbot.db"),
        logsThreadsDir: join(openbotHome, "logs", "threads"),
        workspaceDir: join(openbotHome, "workspace"),
        uploadsDir: join(openbotHome, "uploads"),
        trashDir: join(openbotHome, "trash"),
        vaultPath: join(openbotHome, "vault.bin"),
        vaultKeyPath: join(openbotHome, "vault.key"),
        deviceSecretPath: join(openbotHome, "device-secret"),
        modelsPath: join(openbotHome, "models.json"),
        screensDir: join(openbotHome, "screens"),
        routinesDir: join(openbotHome, "routines"),
        port: 0,
      },
      disableNdjson: true,
    });
    contexts.push(ctx);
    return ctx;
  }

  it("bot rows and the event log persist across closeDb() + a fresh createCoreContext()", async () => {
    openbotHome = await mkdtemp(join(tmpdir(), "openbot-restart-test-"));

    const first = await bootContext();
    const bot = {
      id: newId("bot"),
      slug: "restart-bot",
      name: "Restart Bot",
      description: "",
      pinned: false,
      hidden: false,
      isChiefOfStaff: false,
      createdBy: "user" as const,
      routing: { mode: "auto" as const },
      permissionPreset: "workspace_write" as const,
      computer: "none" as const,
      connectors: [],
      limits: {},
    };
    first.repos.bots.create(bot);
    const published = await first.eventBus.publish({
      type: "bot.created",
      botId: bot.id,
      payload: { bot },
    });
    first.closeDb(); // simulates `openbot serve` shutting down

    const second = await bootContext(); // simulates the next `openbot serve` launch
    expect(second.repos.bots.getById(bot.id)).toEqual(bot);
    expect(second.eventBus.replaySince(0).map((e) => e.id)).toContain(published.id);
  });

  it("the device-auth signing secret persists, so tokens issued before a restart still verify after", async () => {
    openbotHome = await mkdtemp(join(tmpdir(), "openbot-restart-test-"));

    const first = await bootContext();
    const device = {
      id: newId("device"),
      name: "phone",
      role: "approver" as const,
      publicKey: "",
      via: "lan" as const,
      pairedAt: first.clock.now().toISOString(),
    };
    first.repos.devices.create(device);
    const token = first.deviceAuth.issueToken(device.id);
    first.closeDb();

    const second = await bootContext();
    const identity = second.deviceAuth.verifyToken(token);
    expect(identity).toEqual({ deviceId: device.id, role: "approver" });
  });
});
