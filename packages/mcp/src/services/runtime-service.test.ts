import { afterEach, describe, expect, it } from "vitest";
import type { DecisionService } from "@openbot/contracts";
import { createRuntime, InMemoryEventSink } from "@openbot/runtime";
import { FakeClock } from "@openbot/testkit";
import { createMcpTestHarness, makeBot } from "../test-helpers.js";
import type { SessionContext } from "../types.js";
import { McpRuntimeServiceAdapter } from "./runtime-service.js";

let harness: Awaited<ReturnType<typeof createMcpTestHarness>> | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

/** Jev stub: every risk question comes back uncertain, so the broker asks the user. */
const uncertainJev: DecisionService = {
  decide: async () => ({
    answers: {
      external_side_effect: {
        type: "score",
        score: 2,
        confidence: 0.6,
        legend: {},
        probabilities: {},
      },
    },
    provider: "heuristic",
    model: "stub",
    latencyMs: 0,
    decisionId: "dec_stub",
  }),
  route: async () => ({ engine: "fake", model: "fake", band: "auto", decisionId: "dec_stub" }),
  band: () => "confirm",
  budgets: () => ({
    gates: { limitRpm: 0, usedRpm: 0, queued: 0 },
    interactive: { limitRpm: 0, usedRpm: 0, queued: 0 },
    computer: { limitRpm: 0, usedRpm: 0, queued: 0 },
    background: { limitRpm: 0, usedRpm: 0, queued: 0 },
  }),
  validateKey: async () => ({ ok: true }),
};

async function setup() {
  harness = await createMcpTestHarness();
  const runtime = createRuntime({
    decisions: uncertainJev,
    drivers: {},
    clock: new FakeClock(0),
    events: new InMemoryEventSink(),
  });
  const bot = makeBot({ name: "Writer", slug: "writer", permissionPreset: "full" });
  harness.ctx.repos.bots.create(bot);
  const session: SessionContext = {
    botId: bot.id,
    turnId: "turn_test",
    chainId: runtime.chains.create({ origin: "user", mode: "live" }).id,
    mode: "live",
    exp: Number.MAX_SAFE_INTEGER,
    bot,
    isChiefOfStaff: false,
  };
  return { runtime, service: new McpRuntimeServiceAdapter(harness.ctx, runtime), session };
}

async function pendingApprovalId(runtime: ReturnType<typeof createRuntime>): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const [approval] = runtime.approvals.listPending();
    if (approval) return approval.id;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error("no pending approval");
}

describe("McpRuntimeServiceAdapter.permissionPrompt", () => {
  it.each(["allow", "deny"] as const)(
    "waits for the user's answer to the card and returns %s",
    async (resolution) => {
      const { runtime, service, session } = await setup();

      const result = service.permissionPrompt(session, {
        tool_name: "Write",
        input: { path: "notes/todo.md", content: "hi" },
      });
      const approvalId = await pendingApprovalId(runtime);
      runtime.broker.resolveApproval(approvalId, resolution);

      expect(await result).toEqual({ allowed: true, behavior: resolution });
    },
  );
});
