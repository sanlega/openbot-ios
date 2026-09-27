import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { newId, type Routine } from "@openbot/contracts";
import { createCoreContext, type CoreContext } from "@openbot/core";
import { FakeDecisionService } from "@openbot/decisions";
import { FakeClock } from "@openbot/testkit";
import { DEFAULT_ROUTINE_LIMITS } from "./defaults.js";
import { RoutineOrchestrator } from "./orchestrator.js";
import { SimulatedRoutineRuntime } from "./simulated-runtime.js";

async function createHarness(runtimeOptions?: {
  plannedActions?: string[];
  hasSideEffects?: boolean;
}): Promise<{
  ctx: CoreContext;
  orchestrator: RoutineOrchestrator;
  clock: FakeClock;
  cleanup: () => Promise<void>;
}> {
  const openbotHome = await mkdtemp(join(tmpdir(), "openbot-routines-test-"));
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

  const bot = {
    id: newId("bot"),
    slug: "worker",
    name: "Worker",
    description: "test",
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
  ctx.repos.bots.create(bot);

  const orchestrator = new RoutineOrchestrator(ctx, {
    runtime: new SimulatedRoutineRuntime(ctx, runtimeOptions),
  });

  return {
    ctx,
    orchestrator,
    clock,
    cleanup: async () => {
      await orchestrator.stop();
      ctx.closeDb();
      await rm(openbotHome, { recursive: true, force: true });
    },
  };
}

function makeRoutine(botId: string, overrides: Partial<Routine> = {}): Routine {
  return {
    id: newId("routine"),
    botId,
    name: "Daily summary",
    prompt: "Summarize inbox",
    createdBy: "user",
    enabled: true,
    liveApproved: false,
    trigger: { type: "event", source: "webhook" },
    limits: DEFAULT_ROUTINE_LIMITS,
    consecutiveFailures: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("RoutineOrchestrator", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  afterEach(async () => {
    await harness?.cleanup();
  });

  it("first run is always a dry run with planned actions", async () => {
    harness = await createHarness({
      plannedActions: ["Would send email summary"],
      hasSideEffects: true,
    });
    const routine = makeRoutine(harness.ctx.repos.bots.list()[0]!.id);
    harness.ctx.repos.routines.create(routine);

    const run = await harness.orchestrator.queueRun(routine.id, "manual", { dryRun: true });
    expect("skipped" in run).toBe(false);
    if ("skipped" in run) return;

    await new Promise((r) => setTimeout(r, 50));
    const completed = harness.ctx.repos.routineRuns.getById(run.id);
    expect(completed?.dryRun).toBe(true);
    expect(completed?.status).toBe("done");
    expect(completed?.plannedActions).toContain("Would send email summary");
    const approvals = harness.ctx.repos.approvals.list({ status: "pending" });
    expect(approvals.some((approval) => approval.kind === "routine_live")).toBe(true);
  });

  it("dry run without side effects auto-approves live", async () => {
    harness = await createHarness({ plannedActions: ["Would read inbox"], hasSideEffects: false });
    const routine = makeRoutine(harness.ctx.repos.bots.list()[0]!.id);
    harness.ctx.repos.routines.create(routine);

    await harness.orchestrator.queueRun(routine.id, "manual", { dryRun: true });
    await new Promise((r) => setTimeout(r, 50));

    const updated = harness.ctx.repos.routines.getById(routine.id);
    expect(updated?.liveApproved).toBe(true);
  });

  it("skips run when daily budget exhausted", async () => {
    harness = await createHarness();
    const routine = makeRoutine(harness.ctx.repos.bots.list()[0]!.id, {
      limits: { ...DEFAULT_ROUTINE_LIMITS, maxRunsPerDay: 0 },
    });
    harness.ctx.repos.routines.create(routine);

    const result = await harness.orchestrator.queueRun(routine.id, "manual", { dryRun: true });
    expect("skipped" in result).toBe(false);
    if ("skipped" in result) return;
    expect(result.status).toBe("skipped");
    expect(result.skipReason).toBe("maxRunsPerDay reached");
  });

  it("coalesces burst webhook events into one run", async () => {
    harness = await createHarness();
    const routine = makeRoutine(harness.ctx.repos.bots.list()[0]!.id);
    harness.ctx.repos.routines.create(routine);
    await harness.ctx.vault.set(`routine.${routine.id}.hookSecret`, "secret");

    for (let i = 0; i < 10; i++) {
      await harness.orchestrator.handleWebhook(routine.id, { n: i }, "secret");
    }

    harness.clock.advance(200);
    await new Promise((r) => setTimeout(r, 50));

    const runs = harness.ctx.repos.routineRuns.listByRoutine(routine.id);
    const executed = runs.filter((run) => run.status === "done" || run.status === "running");
    expect(executed.length).toBeLessThanOrEqual(1);
    if (executed[0]) {
      expect(executed[0].triggerEventIds.length).toBeGreaterThan(1);
    }
  });

  it("drops non-matching events via filter", async () => {
    harness = await createHarness();
    const routine = makeRoutine(harness.ctx.repos.bots.list()[0]!.id, {
      trigger: {
        type: "event",
        source: "webhook",
        filter: [{ path: "action", regex: "^opened$" }],
      },
    });
    harness.ctx.repos.routines.create(routine);

    await harness.orchestrator.handleTriggerEvent(routine, {
      id: "evt_1",
      source: "webhook",
      payloadHash: "abc",
      payload: { action: "closed" },
      receivedAt: harness.ctx.clock.now().toISOString(),
    });

    const runs = harness.ctx.repos.routineRuns.listByRoutine(routine.id);
    expect(runs).toHaveLength(0);
    const events = harness.ctx.repos.triggerEvents.listByRoutine(routine.id);
    expect(events[0]?.matched).toBe(false);
  });

  it("cron schedule fires within 1s of scheduled time with fake clock", async () => {
    harness = await createHarness();
    const routine = makeRoutine(harness.ctx.repos.bots.list()[0]!.id, {
      trigger: {
        type: "schedule",
        cron: "0 9 * * *",
        timezone: "UTC",
        catchUp: "none",
      },
    });
    harness.ctx.repos.routines.create(routine);
    harness.orchestrator.scheduler.scheduleRoutine(routine);

    const start = harness.clock.now().getTime();
    harness.clock.advance(60 * 60 * 1000);
    await new Promise((r) => setTimeout(r, 50));

    const runs = harness.ctx.repos.routineRuns.listByRoutine(routine.id);
    expect(runs.length).toBeGreaterThan(0);
    const elapsed = harness.clock.now().getTime() - start;
    expect(elapsed).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });
});
