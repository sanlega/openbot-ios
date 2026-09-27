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
        tool_name: "Bash",
        input: { command: "curl -X POST https://example.com/publish" },
      });
      const approvalId = await pendingApprovalId(runtime);
      runtime.broker.resolveApproval(approvalId, resolution);

      expect(await result).toEqual({ allowed: true, behavior: resolution });
    },
  );

  it("allows OpenBot's own tools without a card: their handlers carry the gates", async () => {
    const { runtime, service, session } = await setup();

    const result = await service.permissionPrompt(session, {
      tool_name: "mcp__openbot__send_message",
      input: { bot: "writer", body: "first task" },
    });

    expect(result).toEqual({ allowed: true, behavior: "allow" });
    expect(runtime.approvals.listPending()).toHaveLength(0);
  });

  it("never asks about reads or file edits inside the workspace", async () => {
    const { runtime, service, session } = await setup();

    for (const [tool_name, input] of [
      ["Bash", { command: "ls -la ~/.openbot | head" }],
      ["Read", { file_path: "/etc/hosts" }],
      ["Write", { file_path: "notes/todo.md", content: "hi" }],
    ] as const) {
      expect(await service.permissionPrompt(session, { tool_name, input })).toEqual({
        allowed: true,
        behavior: "allow",
      });
    }
    expect(runtime.approvals.listPending()).toHaveLength(0);
  });

  it("classifies connector tools: catalogue writes get a card, reads run", async () => {
    const { runtime, service, session } = await setup();
    const classify = (write: boolean, action: string) => ({
      kind: "connector_action" as const,
      action,
      target: "GitHub",
      sideEffect: write,
      readOnly: !write,
      summary: `GitHub: ${action}`,
    });
    harness!.ctx.connectorService = {
      catalog: async () => ({ entries: [] }),
      connect: async () => {
        throw new Error("unused");
      },
      listConnections: () => [],
      disconnect: async () => false,
      mcpServersForBot: async () => [],
      classifyTool: (botId, toolName) =>
        botId !== session.botId
          ? undefined
          : toolName === "mcp__github__issue_write"
            ? classify(true, "issue_write")
            : toolName === "mcp__github__list_issues"
              ? classify(false, "list_issues")
              : undefined,
    };

    expect(
      await service.permissionPrompt(session, { tool_name: "mcp__github__list_issues", input: {} }),
    ).toEqual({ allowed: true, behavior: "allow" });
    expect(runtime.approvals.listPending()).toHaveLength(0);

    const write = service.permissionPrompt(session, {
      tool_name: "mcp__github__issue_write",
      input: { title: "Bug" },
    });
    const approvalId = await pendingApprovalId(runtime);
    expect(runtime.approvals.get(approvalId)).toMatchObject({
      kind: "connector_action",
      summary: "GitHub: issue_write",
    });
    runtime.broker.resolveApproval(approvalId, "deny");
    expect(await write).toEqual({ allowed: true, behavior: "deny" });
  });
});
