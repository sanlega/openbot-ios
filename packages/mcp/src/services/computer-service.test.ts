import { afterEach, describe, expect, it } from "vitest";
import type { DecideResult, DecisionService, JevAnswer } from "@openbot/contracts";
import { FakeComputerProvider } from "@openbot/computer-fake";
import { createRuntime, InMemoryEventSink } from "@openbot/runtime";
import { FakeClock } from "@openbot/testkit";
import { createMcpTestHarness, issueToken, makeBot } from "../test-helpers.js";
import type { ComputerTaskView } from "../types.js";
import { McpComputerServiceAdapter } from "./computer-service.js";

let harness: Awaited<ReturnType<typeof createMcpTestHarness>> | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

const choice = (value: string): JevAnswer => ({
  type: "choice",
  choice: value,
  confidence: 0.97,
  probabilities: { [value]: 0.97 },
});

/** Jev stand-in: one scripted step per computer decision; other purposes are uncertain. */
function scriptedJev(script: Array<[op: string, target: string, destructive?: number]>) {
  let i = 0;
  return {
    decide: async (req: { purpose: string }) => {
      if (req.purpose !== "computer") {
        return {
          answers: {},
          provider: "jev",
          model: "scripted",
          latencyMs: 1,
          decisionId: "dec_other",
        } satisfies DecideResult;
      }
      const [op, target, destructive = 0.02] = script[Math.min(i, script.length - 1)]!;
      i += 1;
      return {
        answers: {
          op: choice(op),
          target_index: choice(target),
          key_name: choice("Enter"),
          scroll_direction: choice("down"),
          is_destructive: { type: "noul", noul: destructive },
        },
        provider: "jev",
        model: "scripted",
        latencyMs: 1,
        decisionId: `dec_${i}`,
      } satisfies DecideResult;
    },
    band: () => "human",
  } as unknown as DecisionService;
}

async function setup(script: Array<[string, string, number?]>) {
  harness = await createMcpTestHarness();
  const decisions = scriptedJev(script);
  harness.ctx.decisionService = decisions;
  harness.ctx.computerProvider = new FakeComputerProvider();
  const runtime = createRuntime({
    decisions,
    drivers: {},
    clock: new FakeClock(0),
    events: new InMemoryEventSink(),
  });
  harness.services.computer = new McpComputerServiceAdapter(harness.ctx, runtime);
  const bot = makeBot({ name: "Mailer", slug: "mailer", computer: "docker" });
  const other = makeBot({ name: "Other", slug: "other" });
  harness.ctx.repos.bots.create(bot);
  harness.ctx.repos.bots.create(other);
  const h = harness;
  const call = (tool: string, payload: Record<string, unknown>, who = bot) =>
    h.app
      .inject({
        method: "POST",
        url: `/internal/tools/${tool}`,
        headers: { "x-openbot-session": issueToken(h, who) },
        payload,
      })
      .then((r) => r.json<{ allowed: boolean; reason?: string } & ComputerTaskView>());
  return { runtime, bot, other, call };
}

describe("computer tools over MCP", () => {
  it("runs a task in the background, asks the engine for text, and finishes after steering", async () => {
    const { call, other } = await setup([
      ["click", "0"],
      ["type", "1"],
      ["done", "none"],
    ]);

    const started = await call("computer_task", {
      goal: "Draft an email with subject Q3",
      waitSeconds: 5,
    });
    expect(started).toMatchObject({ allowed: true, status: "needs_input", needsText: "Subject" });

    const intruder = await call("computer_steer", { taskId: started.taskId, text: "x" }, other);
    expect(intruder.allowed).toBe(false);

    const done = await call("computer_steer", {
      taskId: started.taskId,
      text: "Q3 numbers",
      waitSeconds: 5,
    });
    expect(done).toMatchObject({ allowed: true, status: "completed", steps: 3 });
    expect(done.recentSteps.join(" | ")).toContain('type "Subject"');

    const status = await call("computer_status", { taskId: started.taskId });
    expect(status.status).toBe("completed");
  });

  it("a destructive step waits on an approval card, and denying it stops the task", async () => {
    // inbox: click Compose (0) → compose: click Send (3), which Jev flags as destructive
    const { call, runtime } = await setup([
      ["click", "0"],
      ["click", "3", 0.95],
    ]);
    const started = await call("computer_task", { goal: "Send the draft", waitSeconds: 0 });

    let pending = runtime.approvals.listPending();
    for (let i = 0; i < 50 && pending.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
      pending = runtime.approvals.listPending();
    }
    expect(pending).toHaveLength(1);
    expect(pending[0]!.summary).toContain('Click "Send"');

    runtime.broker.resolveApproval(pending[0]!.id, "deny");
    const finished = await call("computer_status", { taskId: started.taskId, waitSeconds: 5 });
    expect(finished.status).toBe("failed");
    expect(finished.summary).toContain("denied");
  });

  it("cancels a running task", async () => {
    const { call } = await setup([
      ["click", "0"],
      ["type", "1"],
    ]);
    const started = await call("computer_task", { goal: "Draft", waitSeconds: 5 });
    expect(started.status).toBe("needs_input");
    const cancelled = await call("computer_cancel", { taskId: started.taskId });
    expect(cancelled.status).toBe("cancelled");
  });
});
