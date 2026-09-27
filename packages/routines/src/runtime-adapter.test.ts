import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  newId,
  type Bot,
  type Chain,
  type EngineDriver,
  type Routine,
  type RoutineRun,
  type TurnHandle,
  type TurnHooks,
  type TurnResult,
} from "@openbot/contracts";
import { createCoreContext, loadConfig, type CoreContext } from "@openbot/core";
import { FakeDecisionService } from "@openbot/decisions";
import { createRuntime, type ChainStore, type EventSink, type Runtime } from "@openbot/runtime";
import { DEFAULT_ROUTINE_LIMITS } from "./defaults.js";
import { applyRoutineLiveApproval } from "./live-approval.js";
import { RoutineRuntimeAdapter } from "./runtime-adapter.js";

type Script = (hooks: TurnHooks) => Promise<void>;

/** Runs `script` for each turn, then replies "done"; `interrupt()` makes the turn end interrupted. */
function scriptedDriver(script: Script): EngineDriver {
  return {
    id: "fake",
    detect: async () => ({ installed: true, login: { ok: true }, apiKey: { ok: true } }),
    validateKey: async () => ({ ok: true }),
    listModels: async () => [],
    dispose: async () => {},
    startTurn(_input, hooks): TurnHandle {
      let interrupted = false;
      const done = (async (): Promise<TurnResult> => {
        await script(hooks);
        await Promise.resolve();
        if (!interrupted) hooks.emit({ type: "text_delta", text: "done" });
        return {
          sessionId: "s1",
          isError: interrupted,
          errorMessage: interrupted ? "interrupted" : undefined,
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      })();
      return {
        steer: async () => {},
        interrupt: async () => {
          interrupted = true;
        },
        done,
      };
    },
  };
}

/** Repo-backed chain store, as `apps/server` wires it. */
class RepoChains implements ChainStore {
  constructor(private readonly ctx: CoreContext) {}
  save(chain: Chain): void {
    const stored = this.ctx.repos.chains.getById(chain.id);
    if (!stored) return this.ctx.repos.chains.create(chain);
    this.ctx.repos.chains.setStatus(chain.id, chain.status);
    this.ctx.repos.chains.incrementCounters(chain.id, {
      usd: chain.usd - stored.usd,
      tokens: chain.tokens - stored.tokens,
      turns: chain.turns - stored.turns,
    });
  }
  get(id: string): Chain | undefined {
    return this.ctx.repos.chains.getById(id);
  }
  list(): Chain[] {
    return this.ctx.repos.chains.list();
  }
}

let ctx: CoreContext | undefined;
let home: string | undefined;

afterEach(async () => {
  ctx?.closeDb();
  if (home) await rm(home, { recursive: true, force: true });
  ctx = undefined;
  home = undefined;
});

async function setup(script: Script) {
  home = await mkdtemp(join(tmpdir(), "openbot-routine-adapter-"));
  ctx = await createCoreContext({
    config: loadConfig({ env: { OPENBOT_HOME: home }, overrides: { dbPath: ":memory:" } }),
    disableNdjson: true,
  });
  const core = ctx;
  const events: EventSink = {
    emit(event) {
      void core.eventBus.publish({ ...event, ts: event.ts ?? new Date().toISOString() });
      return { ...event, id: newId("event"), seq: 0, payload: event.payload ?? {} } as never;
    },
  };
  const runtime: Runtime = createRuntime({
    decisions: new FakeDecisionService(),
    drivers: { fake: scriptedDriver(script) },
    clock: {
      now: () => new Date(),
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
    },
    events,
    chainStore: new RepoChains(core),
  });

  const bot: Bot = {
    id: newId("bot"),
    slug: "digest",
    name: "Digest",
    description: "writes summaries",
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    routing: { mode: "pinned", engine: "fake", model: "fake-default" },
    permissionPreset: "workspace_write",
    computer: "none",
    connectors: [],
    limits: {},
  };
  core.repos.bots.create(bot);
  core.repos.threads.create({
    id: newId("thread"),
    botId: bot.id,
    kind: "dm",
    createdAt: new Date().toISOString(),
  });
  const routine: Routine = {
    id: newId("routine"),
    botId: bot.id,
    name: "Morning summary",
    prompt: "Summarize yesterday and email it to me",
    createdBy: bot.id,
    enabled: true,
    liveApproved: false,
    trigger: { type: "schedule", cron: "0 8 * * *", timezone: "UTC", catchUp: "none" },
    limits: DEFAULT_ROUTINE_LIMITS,
    consecutiveFailures: 0,
    createdAt: new Date().toISOString(),
  };
  core.repos.routines.create(routine);

  function run(dryRun: boolean): RoutineRun {
    const created: RoutineRun = {
      id: newId("routineRun"),
      routineId: routine.id,
      chainId: newId("chain"),
      cause: "manual",
      triggerEventIds: [],
      dryRun,
      status: "queued",
      usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
    };
    core.repos.routineRuns.create(created);
    return created;
  }

  const adapter = new RoutineRuntimeAdapter(runtime, core);
  return { core, adapter, routine, run };
}

describe("RoutineRuntimeAdapter", () => {
  it("dry run: runs the Bot's turn and lists the side effects it planned, executing none", async () => {
    const decisions: string[] = [];
    const { adapter, routine, run } = await setup(async (hooks) => {
      decisions.push(
        await hooks.requestApproval({
          toolName: "send_email",
          input: { url: "mailto:me@example.com", body: "summary" },
          toolUseId: "t1",
        }),
      );
    });

    const result = await adapter.executeRun({ routine, run: run(true), routineDepth: 0 });

    expect(decisions).toEqual(["deny"]);
    expect(result).toMatchObject({
      status: "done",
      hasSideEffects: true,
      plannedActions: ["would send_email: mailto:me@example.com"],
    });
  });

  it("dry run without side effects reports none", async () => {
    const { adapter, routine, run } = await setup(async () => {});
    const result = await adapter.executeRun({ routine, run: run(true), routineDepth: 0 });
    expect(result).toMatchObject({ status: "done", hasSideEffects: false, plannedActions: [] });
  });

  it("live run: interrupts the turn and reports capped once usage passes the per-run cap", async () => {
    let usageEvents = 0;
    const { core, adapter, routine, run } = await setup(async (hooks) => {
      for (let i = 0; i < 10; i++) {
        usageEvents += 1;
        hooks.emit({ type: "usage", inputTokens: 10, outputTokens: 10, usd: 0.2 });
        await Promise.resolve();
      }
    });
    const liveRun = run(false);

    const result = await adapter.executeRun({ routine, run: liveRun, routineDepth: 0 });

    expect(result.status).toBe("capped");
    expect(result.usage.usd).toBeGreaterThan(DEFAULT_ROUTINE_LIMITS.perRun.usd);
    expect(core.repos.chains.getById(liveRun.chainId)?.status).toBe("stopped");
    expect(usageEvents).toBeGreaterThan(0);
  });
});

describe("applyRoutineLiveApproval", () => {
  it("enables live runs when the user allows the routine_live card", async () => {
    const { core, routine, run } = await setup(async () => {});
    const dryRun = run(true);
    core.repos.chains.create({
      id: dryRun.chainId,
      origin: "routine",
      mode: "dry_run",
      routineRunId: dryRun.id,
      status: "done",
      routineDepth: 0,
      botMessages: 0,
      turns: 0,
      usd: 0,
      tokens: 0,
      computerSteps: 0,
      wallMin: 0,
      createdAt: new Date().toISOString(),
    });
    const approval = {
      id: newId("approval"),
      kind: "routine_live" as const,
      botId: routine.botId,
      chainId: dryRun.chainId,
      summary: "Enable live runs?",
      detail: "would send_email",
      status: "pending" as const,
      resolution: undefined,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    core.repos.approvals.create(approval);

    expect(applyRoutineLiveApproval(core, approval.id, "deny")).toBeUndefined();
    expect(core.repos.routines.getById(routine.id)?.liveApproved).toBe(false);
    expect(applyRoutineLiveApproval(core, approval.id, "allow")).toBe(routine.id);
    expect(core.repos.routines.getById(routine.id)?.liveApproved).toBe(true);
  });
});
