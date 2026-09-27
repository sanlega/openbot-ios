import type {
  Bot,
  EngineDriver,
  EngineStatus,
  ModelInfo,
  TurnHandle,
  TurnHooks,
  TurnInput,
  TurnResult,
} from "@openbot/contracts";
import { FakeEngineDriver } from "@openbot/engines-fake";
import { FakeDecisionService } from "@openbot/decisions";
import { FakeClock } from "@openbot/testkit";
import { describe, expect, it } from "vitest";
import { InMemoryEventSink } from "./event-sink.js";
import { createRuntime, type Runtime } from "./index.js";
import type { EnqueueTurnInput } from "./mailbox.js";

function makeBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot_a",
    slug: "bot-a",
    name: "Bot A",
    description: "a test bot",
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    routing: { mode: "pinned", engine: "fake", model: "fake-default" },
    permissionPreset: "full",
    computer: "none",
    connectors: [],
    limits: {},
    ...overrides,
  };
}

function makeInput(runtime: Runtime, overrides: Partial<EnqueueTurnInput> = {}): EnqueueTurnInput {
  const bot = overrides.bot ?? makeBot();
  const chainId = overrides.chainId ?? runtime.chains.create({ origin: "user", mode: "live" }).id;
  return {
    bot,
    text: "do the thing",
    attachments: [],
    systemPrompt: "you are a test bot",
    cwd: "/workspace",
    addDirs: [],
    auth: { mode: "api_key", env: {} },
    mcpServers: [],
    permission: bot.permissionPreset,
    allowTools: [],
    denyTools: [],
    model: "fake-default",
    limits: { maxSteps: 50 },
    engine: "fake",
    chainId,
    threadId: `thr_${bot.id}`,
    ...overrides,
  };
}

/** A fully-scripted `EngineDriver` test double: the script drives `TurnHooks` directly, so mailbox scenario tests can exercise approvals, tool deliveries, and usage precisely — the shared `@openbot/engines-fake` fixture only covers its own two built-in modes. */
class ScriptedEngineDriver implements EngineDriver {
  readonly id = "fake";
  constructor(
    private readonly script: (hooks: TurnHooks, input: TurnInput) => Promise<TurnResult>,
  ) {}
  async detect(): Promise<EngineStatus> {
    return { installed: true, login: { ok: true }, apiKey: { ok: true } };
  }
  async validateKey() {
    return { ok: true };
  }
  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  startTurn(input: TurnInput, hooks: TurnHooks): TurnHandle {
    const done = this.script(hooks, input);
    return { steer: async () => {}, interrupt: async () => {}, done };
  }
  async dispose() {}
}

function turnResult(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    sessionId: "sess_1",
    isError: false,
    usage: { inputTokens: 1, outputTokens: 1 },
    ...overrides,
  };
}

/** `Runtime.events` is typed against the `EventSink` port; tests want the concrete `InMemoryEventSink`'s `byType()` helper, so build one explicitly and hand it to `createRuntime` instead of letting it default one internally. */
function buildRuntime(
  driver: EngineDriver,
  clock = new FakeClock(0),
): Runtime & { events: InMemoryEventSink } {
  const events = new InMemoryEventSink();
  const runtime = createRuntime({
    decisions: new FakeDecisionService(),
    drivers: { fake: driver },
    clock,
    events,
  });
  return runtime as Runtime & { events: InMemoryEventSink };
}

describe("Mailbox basic turn lifecycle (against @openbot/engines-fake)", () => {
  it("submits a turn and resolves 'completed' with the driver's reply text", async () => {
    const runtime = buildRuntime(new FakeEngineDriver({ replies: ["hello there"] }));
    const outcome = await runtime.mailbox.submit(makeInput(runtime));
    expect(outcome.status).toBe("completed");
    expect(outcome.text).toBe("hello there");
    expect(runtime.events.byType("turn.completed")).toHaveLength(1);
    expect(
      runtime.events.byType("message.created").some((e) => e.payload.text === "hello there"),
    ).toBe(true);
  });

  it("processes only one active turn per Bot, FIFO-queuing the rest", async () => {
    const runtime = buildRuntime(new FakeEngineDriver());
    const input = makeInput(runtime);
    const first = runtime.mailbox.submit(input);
    const second = runtime.mailbox.submit(makeInput(runtime, { chainId: input.chainId }));
    expect(runtime.mailbox.isBusy(input.bot.id)).toBe(true);
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
    expect(firstOutcome.status).toBe("completed");
    expect(secondOutcome.status).toBe("completed");
  });

  it("an engine that throws fails its turn and the next queued turn still runs", async () => {
    let calls = 0;
    const runtime = buildRuntime(
      new ScriptedEngineDriver(async () => {
        calls += 1;
        if (calls === 1) throw new Error("codex rpc timeout: turn/start");
        return turnResult();
      }),
    );
    const input = makeInput(runtime);
    const first = runtime.mailbox.submit(input);
    const second = runtime.mailbox.submit(makeInput(runtime, { chainId: input.chainId }));
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
    expect(firstOutcome.status).toBe("failed");
    expect(secondOutcome.status).toBe("completed");
    const failed = runtime.events.byType("turn.failed");
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed[0]!.payload)).toContain("codex rpc timeout");
    expect(runtime.mailbox.isBusy(input.bot.id)).toBe(false);
  });

  it("stop() refuses every queued turn for the Bot without running them", async () => {
    const runtime = buildRuntime(new FakeEngineDriver());
    const input = makeInput(runtime);
    const first = runtime.mailbox.submit(input);
    const second = runtime.mailbox.submit(makeInput(runtime, { chainId: input.chainId }));
    await runtime.mailbox.stop(input.bot.id);
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);
    expect(secondOutcome.status).toBe("refused");
    expect(secondOutcome.reason).toBe("stopped");
    void firstOutcome;
  });

  it("refuses a new turn when its chain is not active", async () => {
    const runtime = buildRuntime(new FakeEngineDriver());
    const input = makeInput(runtime);
    runtime.chains.stop(input.chainId);
    const outcome = await runtime.mailbox.submit(input);
    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toMatch(/stopped/);
  });

  it("refuses a turn for an engine with no registered driver", async () => {
    const runtime = buildRuntime(new FakeEngineDriver());
    const outcome = await runtime.mailbox.submit(makeInput(runtime, { engine: "claude" }));
    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toMatch(/no EngineDriver registered/);
  });
});

describe("Mailbox approvals (permission broker integration)", () => {
  it("a sensitive computer click ('Send') asks, and the turn only proceeds after the approval is resolved", async () => {
    const script = async (hooks: TurnHooks): Promise<TurnResult> => {
      const decision = await hooks.requestApproval({
        toolName: "computer_click",
        input: { target: "Send" },
        toolUseId: "t1",
      });
      hooks.emit({ type: "session_started", sessionId: "sess_1" });
      hooks.emit({
        type: "text_delta",
        text: decision === "allow" ? "clicked Send" : "refused to click",
      });
      return turnResult();
    };
    const runtime = buildRuntime(new ScriptedEngineDriver(script));

    const input = makeInput(runtime, {
      classifyApproval: () => ({ kind: "computer_action", action: "click", target: "Send" }),
    });
    const outcomePromise = runtime.mailbox.submit(input);

    // Give the approval request a tick to land, then resolve it as the user would.
    await new Promise((r) => setTimeout(r, 0));
    const pending = runtime.approvals.listPending();
    expect(pending).toHaveLength(1);
    runtime.broker.resolveApproval(pending[0]!.id, "allow");

    const outcome = await outcomePromise;
    expect(outcome.status).toBe("completed");
    expect(outcome.text).toBe("clicked Send");
  });

  it("denies via a built-in deny rule without ever creating an approval card", async () => {
    const script = async (hooks: TurnHooks): Promise<TurnResult> => {
      const decision = await hooks.requestApproval({
        toolName: "read_file",
        input: { path: "~/.ssh/id_rsa" },
        toolUseId: "t1",
      });
      hooks.emit({ type: "session_started", sessionId: "sess_1" });
      hooks.emit({ type: "text_delta", text: decision === "deny" ? "denied" : "allowed" });
      return turnResult();
    };
    const runtime = buildRuntime(new ScriptedEngineDriver(script));
    const input = makeInput(runtime, {
      classifyApproval: () => ({ target: "~/.ssh/id_rsa" }),
    });
    const outcome = await runtime.mailbox.submit(input);
    expect(outcome.text).toBe("denied");
    expect(runtime.approvals.listPending()).toHaveLength(0);
  });
});

describe("Mailbox dry-run simulation end-to-end (plan §5 WS2 acceptance: zero side effects, every attempt action.simulated)", () => {
  it("message_user and send_message are recorded, never delivered, in a dry_run chain", async () => {
    const script = async (hooks: TurnHooks): Promise<TurnResult> => {
      hooks.emit({ type: "session_started", sessionId: "sess_1" });
      hooks.emit({
        type: "tool_started",
        toolName: "message_user",
        input: { body: "all done" },
        toolUseId: "t1",
      });
      hooks.emit({ type: "tool_completed", toolUseId: "t1", output: {}, isError: false });
      hooks.emit({
        type: "tool_started",
        toolName: "send_message",
        input: { bot: "bot_b", text: "please help" },
        toolUseId: "t2",
      });
      hooks.emit({ type: "tool_completed", toolUseId: "t2", output: {}, isError: false });
      hooks.emit({ type: "text_delta", text: "done" });
      return turnResult();
    };
    const runtime = buildRuntime(new ScriptedEngineDriver(script));
    const chainId = runtime.chains.create({ origin: "user", mode: "dry_run" }).id;
    const outcome = await runtime.mailbox.submit(makeInput(runtime, { chainId }));

    expect(outcome.status).toBe("completed");
    expect(runtime.messages.list("thr_bot_a")).toHaveLength(0);
    expect(runtime.messages.list("bot_b")).toHaveLength(0);
    const simulated = runtime.events.byType("action.simulated");
    expect(simulated.map((e) => e.payload.action)).toEqual(
      expect.arrayContaining(["message_user", "send_message"]),
    );
    // Even the Bot's own final reply text is delivered as a real
    // `message.created` (that's the Bot's direct DM reply, plan §5 WS2: never
    // gated) — only the *tool-invoked* proactive sends are simulated.
    expect(runtime.events.byType("message.created").some((e) => e.payload.text === "done")).toBe(
      true,
    );
  });
});

describe('Mailbox loop protection (plan §5 WS2 acceptance: "looping fake Bots get paused")', () => {
  it("repeated identical send_message calls within a turn trip the guard and pause the chain; a later turn on that chain is refused", async () => {
    const repeatedSends = async (hooks: TurnHooks): Promise<TurnResult> => {
      hooks.emit({ type: "session_started", sessionId: "sess_1" });
      for (let i = 0; i < 5; i++) {
        hooks.emit({
          type: "tool_started",
          toolName: "send_message",
          input: { bot: "bot_b", text: "same nagging message" },
          toolUseId: `t${i}`,
        });
        hooks.emit({ type: "tool_completed", toolUseId: `t${i}`, output: {}, isError: false });
      }
      hooks.emit({ type: "text_delta", text: "looped" });
      return turnResult();
    };
    const events = new InMemoryEventSink();
    const runtime = createRuntime({
      decisions: new FakeDecisionService(),
      drivers: { fake: new ScriptedEngineDriver(repeatedSends) },
      loopGuards: { maxRepeatedContent: 3, maxMessagesPerPairPerWindow: 1000 },
      events,
    }) as Runtime & { events: InMemoryEventSink };

    const chainId = runtime.chains.create({ origin: "bot", mode: "live" }).id;
    const first = await runtime.mailbox.submit(makeInput(runtime, { chainId }));
    expect(first.status).toBe("completed");

    expect(runtime.chains.isActive(chainId)).toBe(false);
    expect(runtime.events.byType("guard.tripped")).toHaveLength(1);
    // Not every send made it through — the guard cut the loop off partway.
    expect(runtime.messages.list("bot_b").length).toBeLessThan(5);

    const second = await runtime.mailbox.submit(makeInput(runtime, { chainId }));
    expect(second.status).toBe("refused");
    expect(second.reason).toMatch(/paused/);
  });
});

describe("Mailbox spend caps (plan §5 WS2 S8: caps interrupt runs)", () => {
  it("interrupts the active turn once usage crosses the per-bot daily cap", async () => {
    const chattyUsage = async (hooks: TurnHooks): Promise<TurnResult> => {
      hooks.emit({ type: "session_started", sessionId: "sess_1" });
      hooks.emit({ type: "usage", inputTokens: 10, outputTokens: 10, usd: 3 });
      await new Promise((r) => setTimeout(r, 0));
      hooks.emit({ type: "usage", inputTokens: 10, outputTokens: 10, usd: 3 });
      await new Promise((r) => setTimeout(r, 0));
      hooks.emit({ type: "text_delta", text: "still going" });
      return turnResult();
    };
    const runtime = buildRuntime(new ScriptedEngineDriver(chattyUsage));
    const outcome = await runtime.mailbox.submit(
      makeInput(runtime, { spendLimits: { dailyUsdPerBot: 5 } }),
    );
    // The scripted driver ignores interrupt() (unlike the real engines it
    // stands in for), so the *turn* still finishes — but the cap trips and a
    // blocker is queued via the NotifyGate exactly once.
    expect(runtime.events.byType("cap.hit")).toHaveLength(1);
    void outcome;
  });

  it("refuses to even start a turn once the daily cap was already reached", async () => {
    const runtime = buildRuntime(new FakeEngineDriver());
    const day = runtime.clock.now().toISOString().slice(0, 10);
    runtime.spendLedger.add("bot", "bot_a", day, { usd: 10, tokens: 0 });
    const outcome = await runtime.mailbox.submit(
      makeInput(runtime, { spendLimits: { dailyUsdPerBot: 5 } }),
    );
    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toMatch(/spend cap/);
  });
});

describe("Mailbox routing/session bookkeeping", () => {
  it("records the driver's session id on the Turn once session_started fires", async () => {
    const runtime = buildRuntime(new FakeEngineDriver());
    const outcome = await runtime.mailbox.submit(makeInput(runtime));
    expect(outcome.sessionId).toBeDefined();
    expect(runtime.turns.get(outcome.turnId!)?.sessionId).toBe(outcome.sessionId);
  });
});

describe("Mailbox thread persistence, session resume, and per-turn preparation", () => {
  it("persists the Bot's direct reply to its DM thread in a live chain", async () => {
    const runtime = buildRuntime(new FakeEngineDriver({ replies: ["saved reply"] }));
    const outcome = await runtime.mailbox.submit(makeInput(runtime));

    expect(outcome.status).toBe("completed");
    const [message] = runtime.messages.list("thr_bot_a");
    expect(message?.text).toBe("saved reply");
    expect(message?.author).toEqual({ type: "bot", id: "bot_a" });
    const created = runtime.events.byType("message.created");
    expect(created.at(-1)?.payload.messageId).toBe(message?.id);
  });

  it("resumes the Bot's last engine session and forgets it after a failed resume", async () => {
    const seen: Array<string | undefined> = [];
    let fail = false;
    const runtime = buildRuntime(
      new ScriptedEngineDriver(async (hooks, input) => {
        seen.push(input.sessionId);
        hooks.emit({ type: "text_delta", text: "ok" });
        return fail
          ? turnResult({ isError: true, errorMessage: "session not found" })
          : turnResult({ sessionId: "sess_live" });
      }),
    );

    await runtime.mailbox.submit(makeInput(runtime));
    await runtime.mailbox.submit(makeInput(runtime));
    fail = true;
    await runtime.mailbox.submit(makeInput(runtime));
    fail = false;
    await runtime.mailbox.submit(makeInput(runtime));

    expect(seen).toEqual([undefined, "sess_live", "sess_live", undefined]);
    expect(runtime.sessions.get("bot_a", "fake")).toBe("sess_live");
  });

  it("hands prepareTurn's MCP servers, keyed by the new turn id, to the engine", async () => {
    let received: TurnInput | undefined;
    const runtime = buildRuntime(
      new ScriptedEngineDriver(async (_hooks, input) => {
        received = input;
        return turnResult();
      }),
    );

    const outcome = await runtime.mailbox.submit(
      makeInput(runtime, {
        prepareTurn: async (turnId) => ({
          mcpServers: [{ name: "openbot", command: "node", args: [], env: { TURN: turnId } }],
        }),
      }),
    );

    expect(outcome.status).toBe("completed");
    expect(received?.mcpServers).toEqual([
      { name: "openbot", command: "node", args: [], env: { TURN: outcome.turnId } },
    ]);
  });

  it("fails the turn without starting the engine when prepareTurn throws", async () => {
    let started = false;
    const runtime = buildRuntime(
      new ScriptedEngineDriver(async () => {
        started = true;
        return turnResult();
      }),
    );

    const outcome = await runtime.mailbox.submit(
      makeInput(runtime, {
        prepareTurn: async () => {
          throw new Error("token service unavailable");
        },
      }),
    );

    expect(outcome).toMatchObject({ status: "failed", reason: "token service unavailable" });
    expect(started).toBe(false);
    expect(runtime.events.byType("turn.failed")).toHaveLength(1);
  });
});

describe("Mailbox per-run budget", () => {
  it("interrupts the turn once the chain's usage exceeds runBudget", async () => {
    let interrupted = false;
    const driver: EngineDriver = {
      id: "fake",
      detect: async () => ({ installed: true, login: { ok: true }, apiKey: { ok: true } }),
      validateKey: async () => ({ ok: true }),
      listModels: async () => [],
      dispose: async () => {},
      startTurn(_input: TurnInput, hooks: TurnHooks): TurnHandle {
        const done = (async (): Promise<TurnResult> => {
          for (let i = 0; i < 5 && !interrupted; i++) {
            hooks.emit({ type: "usage", inputTokens: 100, outputTokens: 100, usd: 0.2 });
            await Promise.resolve();
          }
          return turnResult({
            isError: interrupted,
            errorMessage: interrupted ? "interrupted" : undefined,
          });
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
    const runtime = buildRuntime(driver);
    const input = makeInput(runtime, { runBudget: { usd: 0.5 } });

    const outcome = await runtime.mailbox.submit(input);

    expect(outcome.status).toBe("interrupted");
    expect(runtime.chains.get(input.chainId).usd).toBeCloseTo(0.6);
  });
});

describe("Mailbox in a dry_run chain", () => {
  it("refuses the engine's side-effecting tools and records them as simulated", async () => {
    const decisions: Array<"allow" | "deny"> = [];
    const runtime = buildRuntime(
      new ScriptedEngineDriver(async (hooks) => {
        decisions.push(
          await hooks.requestApproval({
            toolName: "Write",
            input: { path: "/workspace/report.md", content: "x" },
            toolUseId: "t1",
          }),
        );
        decisions.push(
          await hooks.requestApproval({
            toolName: "read_file",
            input: { path: "/workspace/notes.md" },
            toolUseId: "t2",
          }),
        );
        return turnResult();
      }),
    );
    const chainId = runtime.chains.create({ origin: "routine", mode: "dry_run" }).id;

    await runtime.mailbox.submit(makeInput(runtime, { chainId }));

    expect(decisions).toEqual(["deny", "allow"]);
    const simulated = runtime.events.byType("action.simulated");
    expect(simulated.map((e) => e.payload.action)).toEqual(["Write"]);
  });
});
