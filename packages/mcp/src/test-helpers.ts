import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Bot } from "@openbot/contracts";
import { newId } from "@openbot/contracts";
import { createCoreContext, buildServer, type CoreContext } from "@openbot/core";
import type { FastifyInstance } from "fastify";
import { FakeClock } from "@openbot/testkit";
import { integrateMcp } from "./integrate.js";
import type { McpToolServices } from "./services/interfaces.js";
import { createFakeMcpServices } from "./services/fakes.js";
import type { SessionTokenService } from "./session-token.js";

export interface McpTestHarness {
  ctx: CoreContext;
  app: FastifyInstance;
  tokens: SessionTokenService;
  services: McpToolServices;
  clock: FakeClock;
  cleanup: () => Promise<void>;
}

export function makeBot(overrides: Partial<Bot> & Pick<Bot, "name" | "slug">): Bot {
  const { name, slug, ...rest } = overrides;
  return {
    id: newId("bot"),
    description: name,
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    routing: { mode: "auto" },
    permissionPreset: "workspace_write",
    computer: "docker",
    connectors: [],
    limits: {},
    ...rest,
    name,
    slug,
  };
}

export async function createMcpTestHarness(
  options: { services?: McpToolServices } = {},
): Promise<McpTestHarness> {
  const openbotHome = await mkdtemp(join(tmpdir(), "openbot-mcp-test-"));
  const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
  const services = options.services ?? createFakeMcpServices();

  const ctx = await createCoreContext({
    clock,
    disableNdjson: true,
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

  const app = await buildServer(ctx);
  const { tokens } = await integrateMcp(app, ctx, { services });

  return {
    ctx,
    app,
    tokens,
    services,
    clock,
    cleanup: async () => {
      await app.close();
      ctx.closeDb();
      await rm(openbotHome, { recursive: true, force: true });
    },
  };
}

export function issueToken(
  harness: McpTestHarness,
  bot: Bot,
  mode: "live" | "dry_run" = "live",
): string {
  return harness.tokens.issue({
    botId: bot.id,
    turnId: newId("turn"),
    chainId: newId("chain"),
    mode,
  });
}
