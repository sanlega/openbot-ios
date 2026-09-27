import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeClock } from "@openbot/testkit";
import { createCoreContext, type CoreContext } from "@openbot/core";
import { wireConnectors, type ConnectorService } from "./index.js";
import type { MockComposioClient } from "./composio/mock-client.js";

export interface ConnectorTestContext {
  ctx: CoreContext;
  service: ConnectorService;
  composioClient: MockComposioClient;
  clock: FakeClock;
  cleanup: () => Promise<void>;
}

export async function createConnectorTestContext(): Promise<ConnectorTestContext> {
  const openbotHome = await mkdtemp(join(tmpdir(), "openbot-connectors-test-"));
  const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
  const composioKey = "composio_test_key_12345678";

  const ctx = await createCoreContext({
    clock,
    disableNdjson: false,
    config: {
      openbotHome,
      dbPath: ":memory:",
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
  });

  const { MockComposioClient } = await import("./composio/mock-client.js");
  const composioClient = new MockComposioClient(composioKey);
  const service = wireConnectors(ctx, { composioClient, composioApiKey: composioKey });

  return {
    ctx,
    service,
    composioClient,
    clock,
    cleanup: async () => {
      ctx.closeDb();
      await rm(openbotHome, { recursive: true, force: true });
    },
  };
}
