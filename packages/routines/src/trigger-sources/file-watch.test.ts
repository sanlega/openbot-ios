import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { newId, type Routine } from "@openbot/contracts";
import { createCoreContext, type CoreContext } from "@openbot/core";
import { FakeDecisionService } from "@openbot/decisions";
import { FakeClock } from "@openbot/testkit";
import { DEFAULT_ROUTINE_LIMITS } from "../defaults.js";
import { RoutineOrchestrator } from "../orchestrator.js";
import { SimulatedRoutineRuntime } from "../simulated-runtime.js";
import { FileWatchTriggerSource } from "./file-watch.js";

async function createHarness(): Promise<{
  ctx: CoreContext;
  orchestrator: RoutineOrchestrator;
  fileWatch: FileWatchTriggerSource;
  botId: string;
  cleanup: () => Promise<void>;
}> {
  const openbotHome = await mkdtemp(join(tmpdir(), "openbot-filewatch-"));
  const clock = new FakeClock(new Date("2026-01-01T08:00:00.000Z"));
  const ctx = await createCoreContext({
    clock,
    disableNdjson: true,
    decisionService: new FakeDecisionService(),
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

  const botId = newId("bot");
  ctx.repos.bots.create({
    id: botId,
    slug: "worker",
    name: "Worker",
    description: "test",
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    routing: { mode: "auto" },
    permissionPreset: "workspace_write",
    computer: "none",
    connectors: [],
    limits: {},
  });

  const orchestrator = new RoutineOrchestrator(ctx, {
    runtime: new SimulatedRoutineRuntime(ctx, { hasSideEffects: false }),
  });
  const fileWatch = new FileWatchTriggerSource(ctx, orchestrator, { debounceMs: 50 });
  orchestrator.attachTriggerSources({ fileWatch });

  return {
    ctx,
    orchestrator,
    fileWatch,
    botId,
    cleanup: async () => {
      fileWatch.stop();
      await orchestrator.stop();
      ctx.closeDb();
      await rm(openbotHome, { recursive: true, force: true });
    },
  };
}

function makeFileRoutine(botId: string, watchPath: string): Routine {
  return {
    id: newId("routine"),
    botId,
    name: "On file change",
    prompt: "Process new file",
    createdBy: "user",
    enabled: true,
    liveApproved: true,
    trigger: { type: "event", source: "file", path: watchPath },
    limits: DEFAULT_ROUTINE_LIMITS,
    consecutiveFailures: 0,
    createdAt: new Date().toISOString(),
  };
}

describe("FileWatchTriggerSource", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  afterEach(async () => {
    await harness?.cleanup();
  });

  it("registers a watcher for file-trigger routines in allowed workspace", async () => {
    harness = await createHarness();
    const watchDir = join(harness.ctx.config.workspaceDir, "inbox");
    await mkdir(watchDir, { recursive: true });

    const routine = makeFileRoutine(harness.botId, "inbox");
    harness.ctx.repos.routines.create(routine);
    harness.fileWatch.start();

    expect(harness.fileWatch.activeWatcherCount()).toBe(1);
  });

  it("does not watch paths outside allowed roots", async () => {
    harness = await createHarness();
    const routine = makeFileRoutine(harness.botId, "../../../tmp/evil");
    harness.ctx.repos.routines.create(routine);
    harness.fileWatch.start();

    expect(harness.fileWatch.activeWatcherCount()).toBe(0);
  });

  it("debounces and coalesces burst file changes into one trigger", async () => {
    harness = await createHarness();
    const watchDir = join(harness.ctx.config.workspaceDir, "drops");
    await mkdir(watchDir, { recursive: true });

    const routine = makeFileRoutine(harness.botId, "drops");
    harness.ctx.repos.routines.create(routine);
    harness.fileWatch.start();

    await writeFile(join(watchDir, "a.txt"), "one");
    await writeFile(join(watchDir, "b.txt"), "two");
    await writeFile(join(watchDir, "c.txt"), "three");

    await new Promise((r) => setTimeout(r, 200));

    const events = harness.ctx.repos.triggerEvents.listByRoutine(routine.id);
    expect(events.length).toBe(1);
    expect(events[0]?.matched).toBe(true);
  });

  it("refreshes watcher on routine update and removes on delete", async () => {
    harness = await createHarness();
    const dirA = join(harness.ctx.config.workspaceDir, "a");
    const dirB = join(harness.ctx.config.workspaceDir, "b");
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });

    const routine = makeFileRoutine(harness.botId, "a");
    harness.ctx.repos.routines.create(routine);
    harness.fileWatch.start();
    expect(harness.fileWatch.activeWatcherCount()).toBe(1);

    harness.ctx.repos.routines.update(routine.id, {
      trigger: { type: "event", source: "file", path: "b" },
    });
    harness.fileWatch.syncRoutine(harness.ctx.repos.routines.getById(routine.id)!);
    expect(harness.fileWatch.activeWatcherCount()).toBe(1);

    harness.fileWatch.removeRoutine(routine.id);
    expect(harness.fileWatch.activeWatcherCount()).toBe(0);
  });
});
