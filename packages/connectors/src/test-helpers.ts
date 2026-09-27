import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeClock } from "@openbot/testkit";
import { createCoreContext, type CoreContext } from "@openbot/core";
import type { DefaultConnectorService } from "./connector-service.js";
import { MockMcpRegistryClient, type McpRegistryClient } from "./mcp-registry.js";
import { wireConnectors } from "./wire.js";

export interface ConnectorTestContext {
  ctx: CoreContext;
  service: DefaultConnectorService;
  clock: FakeClock;
  cleanup: () => Promise<void>;
}

export async function createConnectorTestContext(options?: {
  registry?: McpRegistryClient;
}): Promise<ConnectorTestContext> {
  const openbotHome = await mkdtemp(join(tmpdir(), "openbot-connectors-test-"));
  const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));

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
      port: 4577,
    },
  });

  const service = wireConnectors(ctx, {
    registry: options?.registry ?? new MockMcpRegistryClient([]),
  });

  return {
    ctx,
    service,
    clock,
    cleanup: async () => {
      ctx.closeDb();
      await rm(openbotHome, { recursive: true, force: true });
    },
  };
}
