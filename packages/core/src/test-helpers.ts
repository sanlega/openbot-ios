import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeClock } from "@openbot/testkit";
import { createCoreContext, type CoreContext, type CreateCoreContextOptions } from "./context.js";

/**
 * Test-only helper: an isolated `CoreContext` (own temp `OPENBOT_HOME`, own
 * in-memory-or-file DB, deterministic `FakeClock`) plus a `cleanup()` that
 * tears down the DB handle and deletes the temp dir. Every WS1 test in this
 * package goes through this instead of hand-rolling config, so parallel test
 * files never race on the same vault/db files (see `apps/server`'s test for
 * the bug this avoids).
 */
export interface TestContext {
  ctx: CoreContext;
  clock: FakeClock;
  cleanup: () => Promise<void>;
}

export async function createTestContext(
  options: Partial<CreateCoreContextOptions> & { persistent?: boolean } = {},
): Promise<TestContext> {
  const openbotHome = await mkdtemp(join(tmpdir(), "openbot-core-test-"));
  const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));

  const ctx = await createCoreContext({
    ...options,
    clock,
    config: {
      openbotHome,
      dbPath: options.persistent ? join(openbotHome, "openbot.db") : ":memory:",
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
    disableNdjson: options.disableNdjson ?? true,
  });

  return {
    ctx,
    clock,
    cleanup: async () => {
      ctx.closeDb();
      await rm(openbotHome, { recursive: true, force: true });
    },
  };
}
