import { describe, expect, it, afterEach } from "vitest";
import { newId, type Bot } from "@openbot/contracts";
import { openDb, type Db } from "./db.js";
import { BotsRepo } from "./bots-repo.js";
import { ThreadsRepo } from "./threads-repo.js";
import { MessagesRepo } from "./messages-repo.js";
import { ChainsRepo } from "./chains-repo.js";
import { TurnsRepo } from "./turns-repo.js";
import { ApprovalsRepo } from "./approvals-repo.js";
import { RulesRepo } from "./rules-repo.js";
import { DevicesRepo } from "./devices-repo.js";
import { ConnectionsRepo } from "./connections-repo.js";
import { ComputerTasksRepo } from "./computer-tasks-repo.js";
import { RoutinesRepo } from "./routines-repo.js";
import { RoutineRunsRepo } from "./routine-runs-repo.js";
import { TriggerEventsRepo } from "./trigger-events-repo.js";
import { EngineSessionsRepo } from "./engine-sessions-repo.js";
import { DecisionsRepo } from "./decisions-repo.js";
import { CapCountersRepo } from "./cap-counters-repo.js";
import { SettingsRepo } from "./settings-repo.js";
import { SetupStateRepo } from "./setup-state-repo.js";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function useDb(): Db {
  const { db, close } = openDb({ path: ":memory:" });
  cleanup = close;
  return db;
}

const now = () => new Date().toISOString();

function createBot(db: Db): Bot {
  const bot: Bot = {
    id: newId("bot"),
    slug: `bot-${Math.random().toString(36).slice(2)}`,
    name: "Test Bot",
    description: "d",
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    routing: { mode: "auto" },
    permissionPreset: "workspace_write",
    computer: "none",
    connectors: [],
    limits: {},
  };
  new BotsRepo(db).create(bot);
  return bot;
}

describe("BotsRepo (WS1 additions)", () => {
  it("updates mutable fields without touching id/slug/createdBy", () => {
    const db = useDb();
    const repo = new BotsRepo(db);
    const bot = createBot(db);

    repo.update(bot.id, { name: "Renamed", pinned: true, limits: { dailyUsd: 3 } });

    const fetched = repo.getById(bot.id);
    expect(fetched?.name).toBe("Renamed");
    expect(fetched?.pinned).toBe(true);
    expect(fetched?.limits.dailyUsd).toBe(3);
    expect(fetched?.slug).toBe(bot.slug);
  });

  it("archives a bot and excludes it from list() by default", () => {
    const db = useDb();
    const repo = new BotsRepo(db);
    const bot = createBot(db);

    repo.archive(bot.id, new Date());

    expect(repo.list().map((b) => b.id)).not.toContain(bot.id);
    expect(repo.list({ includeArchived: true }).map((b) => b.id)).toContain(bot.id);
  });

  it("finds a bot by slug", () => {
    const db = useDb();
    const repo = new BotsRepo(db);
    const bot = createBot(db);
    expect(repo.getBySlug(bot.slug)?.id).toBe(bot.id);
  });
});

describe("ThreadsRepo", () => {
  it("round-trips a thread and finds it by botId", () => {
    const db = useDb();
    const bot = createBot(db);
    const repo = new ThreadsRepo(db);
    const thread = { id: newId("thread"), botId: bot.id, kind: "dm" as const, createdAt: now() };

    repo.create(thread);

    expect(repo.getById(thread.id)?.botId).toBe(bot.id);
    expect(repo.getByBotId(bot.id)?.id).toBe(thread.id);
    expect(repo.list()).toHaveLength(1);
  });
});

describe("MessagesRepo", () => {
  it("lists proactive delivered messages since a time", () => {
    const db = useDb();
    const bot = createBot(db);
    const thread = { id: newId("thread"), botId: bot.id, kind: "dm" as const, createdAt: now() };
    new ThreadsRepo(db).create(thread);
    const repo = new MessagesRepo(db);
    const base = {
      threadId: thread.id,
      author: { type: "bot" as const, id: bot.id },
      attachments: [],
      hop: 0,
      proactive: true,
      pushed: false,
    };
    repo.create({
      ...base,
      id: newId("message"),
      text: "old",
      createdAt: "2026-09-26T08:00:00.000Z",
      delivery: "delivered",
    });
    repo.create({
      ...base,
      id: newId("message"),
      text: "new",
      createdAt: "2026-09-27T08:00:00.000Z",
      delivery: "delivered",
    });
    repo.create({
      ...base,
      id: newId("message"),
      text: "held",
      createdAt: "2026-09-27T08:05:00.000Z",
      delivery: "held",
    });
    repo.create({
      ...base,
      id: newId("message"),
      text: "reply",
      createdAt: "2026-09-27T08:06:00.000Z",
      delivery: "delivered",
      proactive: false,
    });

    const since = new Date("2026-09-27T00:00:00.000Z");
    expect(repo.listProactiveDeliveredSince(since).map((m) => m.text)).toEqual(["new"]);
  });

  it("round-trips a message and filters by delivery", () => {
    const db = useDb();
    const bot = createBot(db);
    const thread = { id: newId("thread"), botId: bot.id, kind: "dm" as const, createdAt: now() };
    new ThreadsRepo(db).create(thread);
    const repo = new MessagesRepo(db);

    const delivered = {
      id: newId("message"),
      threadId: thread.id,
      author: { type: "bot" as const, id: bot.id },
      text: "done",
      attachments: [],
      hop: 0,
      createdAt: now(),
      proactive: true,
      kind: "result" as const,
      delivery: "delivered" as const,
      pushed: false,
    };
    const held = { ...delivered, id: newId("message"), delivery: "held" as const, text: "chatter" };
    repo.create(delivered);
    repo.create(held);

    expect(repo.list({ threadId: thread.id, delivery: "held" }).map((m) => m.text)).toEqual([
      "chatter",
    ]);

    repo.updateDelivery(held.id, "delivered");
    expect(repo.getById(held.id)?.delivery).toBe("delivered");
  });

  it("finds a duplicate dedupeKey within the window and not outside it", () => {
    const db = useDb();
    const bot = createBot(db);
    const thread = { id: newId("thread"), botId: bot.id, kind: "dm" as const, createdAt: now() };
    new ThreadsRepo(db).create(thread);
    const repo = new MessagesRepo(db);
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    repo.create({
      id: newId("message"),
      threadId: thread.id,
      author: { type: "bot", id: bot.id },
      text: "first",
      attachments: [],
      hop: 0,
      createdAt: createdAt.toISOString(),
      proactive: true,
      delivery: "delivered",
      pushed: false,
      dedupeKey: "dup-1",
    });

    const withinWindow = new Date(createdAt.getTime() + 60_000);
    const afterWindow = new Date(createdAt.getTime() + 7 * 3600_000);
    expect(repo.findByDedupeKey("dup-1", 6 * 3600_000, withinWindow)).toBeDefined();
    expect(repo.findByDedupeKey("dup-1", 6 * 3600_000, afterWindow)).toBeUndefined();
  });
});

describe("ChainsRepo", () => {
  it("round-trips a chain and increments counters", () => {
    const db = useDb();
    const repo = new ChainsRepo(db);
    const chain = {
      id: newId("chain"),
      origin: "user" as const,
      mode: "live" as const,
      status: "active" as const,
      routineDepth: 0,
      botMessages: 0,
      turns: 0,
      usd: 0,
      tokens: 0,
      computerSteps: 0,
      wallMin: 0,
      createdAt: now(),
    };
    repo.create(chain);

    repo.incrementCounters(chain.id, { turns: 1, usd: 0.5 });
    repo.incrementCounters(chain.id, { turns: 1, usd: 0.25 });
    const fetched = repo.getById(chain.id);
    expect(fetched?.turns).toBe(2);
    expect(fetched?.usd).toBeCloseTo(0.75);

    repo.setStatus(chain.id, "stopped");
    expect(repo.getById(chain.id)?.status).toBe("stopped");
  });
});

describe("TurnsRepo", () => {
  it("round-trips a turn and lists by chain/bot", () => {
    const db = useDb();
    const bot = createBot(db);
    const repo = new TurnsRepo(db);
    const chainId = newId("chain");
    const turn = {
      id: newId("turn"),
      botId: bot.id,
      chainId,
      engine: "fake" as const,
      model: "fake-default",
      status: "running" as const,
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
      createdAt: now(),
    };
    repo.create(turn);

    repo.updateStatus(turn.id, "completed", { inputTokens: 10, outputTokens: 5, usd: 0.01 });
    const fetched = repo.getById(turn.id);
    expect(fetched?.status).toBe("completed");
    expect(fetched?.usage.inputTokens).toBe(10);
    expect(repo.listByChain(chainId)).toHaveLength(1);
    expect(repo.listByBot(bot.id)).toHaveLength(1);

    repo.setSessionId(turn.id, "sess-42");
    expect(repo.getById(turn.id)?.sessionId).toBe("sess-42");
  });
});

describe("ApprovalsRepo", () => {
  it("resolves a pending approval and ignores an already-resolved one", () => {
    const db = useDb();
    const bot = createBot(db);
    const repo = new ApprovalsRepo(db);
    const approval = {
      id: newId("approval"),
      kind: "tool" as const,
      botId: bot.id,
      summary: "write file",
      detail: "detail",
      status: "pending" as const,
      resolution: undefined,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: now(),
    };
    repo.create(approval);

    repo.resolve(approval.id, "allow");
    expect(repo.getById(approval.id)?.status).toBe("resolved");
    expect(repo.getById(approval.id)?.resolution).toBe("allow");

    repo.resolve(approval.id, "deny");
    expect(repo.getById(approval.id)?.resolution).toBe("allow");
  });

  it("expires pending approvals past their expiresAt", () => {
    const db = useDb();
    const bot = createBot(db);
    const repo = new ApprovalsRepo(db);
    const pastExpiry = new Date(Date.now() - 60_000).toISOString();
    const approval = {
      id: newId("approval"),
      kind: "tool" as const,
      botId: bot.id,
      summary: "x",
      detail: "x",
      status: "pending" as const,
      resolution: undefined,
      expiresAt: pastExpiry,
      createdAt: now(),
    };
    repo.create(approval);

    const changed = repo.expirePastDue(new Date());
    expect(changed).toBe(1);
    expect(repo.getById(approval.id)?.status).toBe("expired");
  });
});

describe("RulesRepo", () => {
  it("round-trips a rule and deletes it", () => {
    const db = useDb();
    const repo = new RulesRepo(db);
    const rule = {
      id: newId("rule"),
      scope: "global" as const,
      match: { tool: "bash" },
      effect: "deny" as const,
      source: "builtin" as const,
      createdAt: now(),
    };
    repo.create(rule);
    expect(repo.list()).toHaveLength(1);
    repo.delete(rule.id);
    expect(repo.list()).toHaveLength(0);
  });
});

describe("DevicesRepo", () => {
  it("round-trips a device, touches lastSeenAt, and revokes it", () => {
    const db = useDb();
    const repo = new DevicesRepo(db);
    const device = {
      id: newId("device"),
      name: "phone",
      role: "approver" as const,
      publicKey: "pk",
      via: "lan" as const,
      pairedAt: now(),
    };
    repo.create(device);

    const seenAt = new Date();
    repo.touchLastSeen(device.id, seenAt);
    expect(repo.getById(device.id)?.lastSeenAt).toBe(seenAt.toISOString());

    repo.revoke(device.id, new Date());
    expect(repo.getById(device.id)?.revokedAt).toBeDefined();
  });
});

describe("ConnectionsRepo", () => {
  it("round-trips a connection and updates status", () => {
    const db = useDb();
    const repo = new ConnectionsRepo(db);
    const connection = {
      id: newId("connection"),
      provider: "mcp" as const,
      appId: "github",
      displayName: "GitHub",
      status: "connected" as const,
      toolMeta: { create_issue: { sideEffect: true } },
      triggers: [],
      createdAt: now(),
    };
    repo.create(connection);
    repo.setStatus(connection.id, "error");
    expect(repo.getById(connection.id)?.status).toBe("error");
  });
});

describe("ComputerTasksRepo", () => {
  it("round-trips a computer task and updates progress", () => {
    const db = useDb();
    const bot = createBot(db);
    const repo = new ComputerTasksRepo(db);
    const task = {
      id: newId("computerTask"),
      botId: bot.id,
      chainId: newId("chain"),
      goal: "book a table",
      provider: "fake" as const,
      status: "queued" as const,
      steps: 0,
      usd: 0,
      createdAt: now(),
    };
    repo.create(task);
    repo.update(task.id, { status: "completed", steps: 4, usd: 0.02 });
    expect(repo.getById(task.id)?.status).toBe("completed");
    expect(repo.listByBot(bot.id)).toHaveLength(1);
  });
});

describe("RoutinesRepo and RoutineRunsRepo", () => {
  it("round-trips a routine, updates it, and tracks its runs", () => {
    const db = useDb();
    const bot = createBot(db);
    const routines = new RoutinesRepo(db);
    const routine = {
      id: newId("routine"),
      botId: bot.id,
      name: "Daily summary",
      prompt: "summarize",
      createdBy: bot.id,
      enabled: true,
      liveApproved: false,
      trigger: {
        type: "schedule" as const,
        cron: "0 8 * * *",
        timezone: "UTC",
        catchUp: "none" as const,
      },
      limits: {
        perRun: { usd: 0.5, tokens: 200_000, turns: 10, computerSteps: 50, wallMin: 15 },
        dailyUsd: 2,
        maxRunsPerDay: 24,
        cooldownSec: 60,
      },
      consecutiveFailures: 0,
      createdAt: now(),
    };
    routines.create(routine);
    routines.update(routine.id, { liveApproved: true });
    expect(routines.getById(routine.id)?.liveApproved).toBe(true);
    expect(routines.listByBot(bot.id)).toHaveLength(1);

    const runs = new RoutineRunsRepo(db);
    const run = {
      id: newId("routineRun"),
      routineId: routine.id,
      chainId: newId("chain"),
      cause: "schedule" as const,
      triggerEventIds: [],
      dryRun: true,
      status: "queued" as const,
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
    };
    runs.create(run);
    runs.update(run.id, { status: "done", resultSummary: "ok" });
    expect(runs.listByRoutine(routine.id)[0]?.status).toBe("done");

    routines.delete(routine.id);
    expect(routines.getById(routine.id)).toBeUndefined();
  });
});

describe("TriggerEventsRepo", () => {
  it("dedupes by payloadHash within the same routine", () => {
    const db = useDb();
    const repo = new TriggerEventsRepo(db);
    const routineId = newId("routine");
    const event = {
      id: newId("triggerEvent"),
      source: "webhook",
      routineId,
      payloadHash: "hash-1",
      payloadRef: "ref-1",
      matched: true,
      receivedAt: now(),
    };
    repo.create(event);
    expect(repo.findByPayloadHash(routineId, "hash-1")?.id).toBe(event.id);
    expect(repo.findByPayloadHash(routineId, "hash-2")).toBeUndefined();
    expect(repo.listByRoutine(routineId)).toHaveLength(1);
  });
});

describe("EngineSessionsRepo", () => {
  it("round-trips a session and touches lastUsedAt", () => {
    const db = useDb();
    const bot = createBot(db);
    const repo = new EngineSessionsRepo(db);
    const session = {
      id: newId("bot"),
      botId: bot.id,
      engine: "claude" as const,
      sessionId: "sess-1",
      createdAt: now(),
      lastUsedAt: now(),
    };
    repo.create(session);
    expect(repo.getForBotAndEngine(bot.id, "claude")?.sessionId).toBe("sess-1");

    const touchedAt = new Date();
    repo.touch(session.id, touchedAt);
    expect(repo.getForBotAndEngine(bot.id, "claude")?.lastUsedAt).toBe(touchedAt.toISOString());
  });

  it("upserts one row per bot and engine, and deletes it", () => {
    const db = useDb();
    const bot = createBot(db);
    const repo = new EngineSessionsRepo(db);
    const first = new Date("2026-09-27T10:00:00.000Z");
    const second = new Date("2026-09-27T11:00:00.000Z");

    repo.upsert({
      id: `${bot.id}:codex`,
      botId: bot.id,
      engine: "codex",
      sessionId: "a",
      at: first,
    });
    repo.upsert({
      id: `${bot.id}:codex`,
      botId: bot.id,
      engine: "codex",
      sessionId: "b",
      at: second,
    });

    const stored = repo.getForBotAndEngine(bot.id, "codex");
    expect(stored).toMatchObject({ sessionId: "b", createdAt: first.toISOString() });
    expect(stored?.lastUsedAt).toBe(second.toISOString());

    repo.deleteForBotAndEngine(bot.id, "codex");
    expect(repo.getForBotAndEngine(bot.id, "codex")).toBeUndefined();
  });
});

describe("DecisionsRepo", () => {
  it("round-trips a decision, filters by purpose, and records feedback", () => {
    const db = useDb();
    const repo = new DecisionsRepo(db);
    const decision = {
      id: newId("decision"),
      purpose: "spawn",
      provider: "jev" as const,
      model: "jev-1.13.0",
      stateHash: "abc",
      answers: { should_spawn: { type: "noul", noul: 0.1 } },
      band: "human" as const,
      outcome: "deny" as const,
      createdAt: now(),
    };
    repo.create(decision);
    expect(repo.list({ purpose: "spawn" })).toHaveLength(1);
    expect(repo.list({ purpose: "notify" })).toHaveLength(0);

    repo.setFeedback(decision.id, "mute");
    expect(repo.getById(decision.id)?.feedback).toBe("mute");
  });
});

describe("CapCountersRepo", () => {
  it("increments within a window and resets once the window elapses", () => {
    const db = useDb();
    const repo = new CapCountersRepo(db);
    const t0 = new Date("2026-01-01T00:00:00.000Z");

    expect(repo.incrementInWindow("spawn", "global", 3600, t0, 1)).toBe(1);
    const t1 = new Date(t0.getTime() + 60_000);
    expect(repo.incrementInWindow("spawn", "global", 3600, t1, 1)).toBe(2);

    const afterWindow = new Date(t0.getTime() + 2 * 3600_000);
    expect(repo.incrementInWindow("spawn", "global", 3600, afterWindow, 1)).toBe(1);
  });
});

describe("SettingsRepo", () => {
  it("upserts and reads back the singleton settings row", () => {
    const db = useDb();
    const repo = new SettingsRepo(db);
    expect(repo.get()).toBeUndefined();

    repo.upsert({
      id: "singleton",
      caps: { s1: 6, s2: 2 },
      budgets: { gates: 250, interactive: 200, computer: 450, background: 100 },
      updatedAt: now(),
    });
    expect(repo.get()?.caps.s1).toBe(6);

    repo.upsert({
      id: "singleton",
      caps: { s1: 5 },
      budgets: { gates: 250, interactive: 200, computer: 450, background: 100 },
      updatedAt: now(),
    });
    expect(repo.get()?.caps.s1).toBe(5);
  });
});

describe("SetupStateRepo", () => {
  it("returns an empty singleton by default and patches incrementally", () => {
    const db = useDb();
    const repo = new SetupStateRepo(db);
    expect(repo.get()).toEqual({ id: "singleton" });

    repo.patch({ typesafe: { ok: true } });
    repo.patch({ claude: { ok: true, mode: "login" } });

    const state = repo.get();
    expect(state.typesafe?.ok).toBe(true);
    expect(state.claude).toEqual({ ok: true, mode: "login" });
  });
});
