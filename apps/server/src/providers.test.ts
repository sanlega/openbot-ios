import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EngineStatus } from "@openbot/contracts";
import { FakeClock } from "@openbot/testkit";
import { createCoreContext } from "@openbot/core";
import { FakeComputerProvider } from "@openbot/computer-fake";
import { FakeDecisionService } from "@openbot/decisions";
import { FakeEngineDriver } from "@openbot/engines-fake";
import { ClaudeDriver } from "@openbot/engines-claude";
import { CodexDriver } from "@openbot/engines-codex";
import { bootstrapProviders, type ProviderDetection } from "./providers.js";

const readyClaude: EngineStatus = {
  installed: true,
  version: "1.0.0",
  login: { ok: true, account: "user@example.com" },
  apiKey: { ok: false },
};

const readyCodex: EngineStatus = {
  installed: true,
  version: "1.0.0",
  login: { ok: true },
  apiKey: { ok: false },
};

const missingEngine: EngineStatus = {
  installed: false,
  login: { ok: false },
  apiKey: { ok: false },
};

function mockDetection(overrides: Partial<ProviderDetection> = {}): ProviderDetection {
  return {
    detectClaude: vi.fn(async () => readyClaude),
    detectCodex: vi.fn(async () => readyCodex),
    dockerPing: vi.fn(async () => true),
    ...overrides,
  };
}

async function testContext() {
  const openbotHome = await mkdtemp(join(tmpdir(), "openbot-providers-test-"));
  const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
  const ctx = await createCoreContext({
    clock,
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
      port: 3847,
    },
  });
  return ctx;
}

describe("bootstrapProviders", () => {
  it("selects real providers when prerequisites are present (mocked detection)", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_JEV;
    delete process.env.OPENBOT_FAKE_ENGINES;
    delete process.env.OPENBOT_FAKE_COMPUTER;
    delete process.env.OPENBOT_LOCAL_COMPUTER;
    delete process.env.JEV_API_KEY;

    const ctx = await testContext();
    await ctx.vault.set("typesafe.apiKey", "ts_live_key_1234567890");

    const detection = mockDetection();
    const result = await bootstrapProviders(ctx, detection);

    expect(result.decisionService).not.toBeInstanceOf(FakeDecisionService);
    expect(result.drivers.claude).toBeInstanceOf(ClaudeDriver);
    expect(result.drivers.codex).toBeInstanceOf(CodexDriver);
    expect(result.drivers.fake).toBeUndefined();
    expect(result.computerProvider?.id).toBe("docker");
    expect(result.availableEngines).toEqual(["claude", "codex"]);

    ctx.closeDb();
    process.env = prev;
  });

  it("uses explicit fake flags for tests and CI", async () => {
    const prev = { ...process.env };
    process.env.OPENBOT_FAKE_JEV = "1";
    process.env.OPENBOT_FAKE_ENGINES = "1";
    process.env.OPENBOT_FAKE_COMPUTER = "1";

    const ctx = await testContext();
    const detection = mockDetection({
      detectClaude: vi.fn(async () => readyClaude),
      detectCodex: vi.fn(async () => readyCodex),
    });
    const result = await bootstrapProviders(ctx, detection);

    expect(result.decisionService).toBeInstanceOf(FakeDecisionService);
    expect(result.drivers.fake).toBeInstanceOf(FakeEngineDriver);
    expect(result.drivers.claude).toBeUndefined();
    expect(result.computerProvider).toBeInstanceOf(FakeComputerProvider);

    ctx.closeDb();
    process.env = prev;
  });

  it("skips engines when CLIs and keys are absent", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_ENGINES;

    const ctx = await testContext();
    const detection = mockDetection({
      detectClaude: vi.fn(async () => missingEngine),
      detectCodex: vi.fn(async () => missingEngine),
      dockerPing: vi.fn(async () => false),
    });
    const result = await bootstrapProviders(ctx, detection);

    expect(result.drivers).toEqual({});
    expect(result.availableEngines).toEqual([]);
    expect(result.computerProvider).toBeUndefined();

    ctx.closeDb();
    process.env = prev;
  });

  it("uses LocalProvider when the user opts in", async () => {
    const prev = { ...process.env };
    delete process.env.OPENBOT_FAKE_COMPUTER;
    process.env.OPENBOT_LOCAL_COMPUTER = "1";

    const ctx = await testContext();
    const result = await bootstrapProviders(ctx, mockDetection());

    expect(result.computerProvider?.id).toBe("local");

    ctx.closeDb();
    process.env = prev;
  });
});
