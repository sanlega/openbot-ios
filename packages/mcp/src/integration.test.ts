import { afterEach, describe, expect, it } from "vitest";
import { newId } from "@openbot/contracts";
import { McpComposer } from "./composer.js";
import { OPENBOT_TOOL_DEFINITIONS } from "./tool-definitions.js";
import { createFakeMcpServices } from "./services/fakes.js";
import { createMcpTestHarness, issueToken, makeBot } from "./test-helpers.js";

let harness: Awaited<ReturnType<typeof createMcpTestHarness>> | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

describe("POST /internal/tools/* integration", () => {
  it("lists bots for a valid session token", async () => {
    harness = await createMcpTestHarness();
    const bot = makeBot({ name: "Alpha", slug: "alpha" });
    harness.ctx.repos.bots.create(bot);

    const res = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/list_bots",
      headers: { "x-openbot-session": issueToken(harness, bot) },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ allowed: true; bots: Array<{ slug: string }> }>();
    expect(body.allowed).toBe(true);
    expect(body.bots.map((b) => b.slug)).toContain("alpha");
  });

  it("rejects missing and forged session tokens", async () => {
    harness = await createMcpTestHarness();
    const bot = makeBot({ name: "Beta", slug: "beta" });
    harness.ctx.repos.bots.create(bot);

    const missing = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/list_bots",
      payload: {},
    });
    expect(missing.statusCode).toBe(401);

    const forged = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/list_bots",
      headers: { "x-openbot-session": `${issueToken(harness, bot)}tampered` },
      payload: {},
    });
    expect(forged.statusCode).toBe(401);
  });

  it("refuses create_bot for non-CoS bots with structured result", async () => {
    harness = await createMcpTestHarness();
    const bot = makeBot({ name: "Worker", slug: "worker", isChiefOfStaff: false });
    harness.ctx.repos.bots.create(bot);

    const res = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/create_bot",
      headers: { "x-openbot-session": issueToken(harness, bot) },
      payload: {
        name: "New",
        description: "d",
        responsibility: "r",
        why_not_existing: "w",
        lifetime: "one_off",
        boundary: [],
        user_requested: false,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      allowed: false,
      reason: "create_bot is only available to the Chief of Staff",
      suggestion: "delegate to the CoS or reuse an existing bot",
    });
  });

  it("allows create_bot for the Chief of Staff via fake cos service", async () => {
    const services = createFakeMcpServices();
    harness = await createMcpTestHarness({ services });
    const cos = makeBot({ name: "CoS", slug: "cos", isChiefOfStaff: true });
    harness.ctx.repos.bots.create(cos);

    const res = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/create_bot",
      headers: { "x-openbot-session": issueToken(harness, cos) },
      payload: {
        name: "Research",
        description: "Research bot",
        responsibility: "Research",
        why_not_existing: "No specialist",
        lifetime: "recurring",
        boundary: ["research"],
        user_requested: true,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ allowed: true; bot: { name: string } }>();
    expect(body.allowed).toBe(true);
    expect(body.bot.name).toBe("Research");
    expect(services.cos.createBotCalls).toHaveLength(1);
  });

  it("routes dry_run tokens to simulation for send_message", async () => {
    const services = createFakeMcpServices();
    harness = await createMcpTestHarness({ services });
    const bot = makeBot({ name: "Dry", slug: "dry" });
    harness.ctx.repos.bots.create(bot);

    const res = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/send_message",
      headers: { "x-openbot-session": issueToken(harness, bot, "dry_run") },
      payload: { bot: "alpha", text: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ allowed: true, queued: false, simulated: true });
  });

  it("delegates message_user to the cos fake", async () => {
    const services = createFakeMcpServices({ cos: { messageDelivery: "held" } });
    harness = await createMcpTestHarness({ services });
    const bot = makeBot({ name: "Notifier", slug: "notifier" });
    harness.ctx.repos.bots.create(bot);

    const res = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/message_user",
      headers: { "x-openbot-session": issueToken(harness, bot) },
      payload: { kind: "result", body: "Done" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ allowed: true, delivery: "held" });
  });

  it("handles computer_task and request_approval", async () => {
    const services = createFakeMcpServices();
    harness = await createMcpTestHarness({ services });
    const bot = makeBot({ name: "Ops", slug: "ops", computer: "docker" });
    harness.ctx.repos.bots.create(bot);
    const token = issueToken(harness, bot);

    const task = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/computer_task",
      headers: { "x-openbot-session": token },
      payload: { goal: "open inbox" },
    });
    expect(task.statusCode).toBe(200);
    expect(task.json()).toMatchObject({ allowed: true, status: "completed" });

    const approval = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/request_approval",
      headers: { "x-openbot-session": token },
      payload: { summary: "Write file", detail: "path=/workspace/a.txt" },
    });
    expect(approval.statusCode).toBe(200);
    expect(approval.json<{ allowed: true; approvalId: string }>().approvalId).toMatch(/^apr_/);
  });

  it("handles routine tools", async () => {
    const services = createFakeMcpServices();
    harness = await createMcpTestHarness({ services });
    const bot = makeBot({ name: "Scheduler", slug: "scheduler" });
    harness.ctx.repos.bots.create(bot);
    const token = issueToken(harness, bot);

    const created = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/create_routine",
      headers: { "x-openbot-session": token },
      payload: {
        name: "Daily",
        prompt: "Summarize",
        trigger: { type: "schedule", cron: "0 8 * * *", timezone: "UTC", catchUp: "none" },
      },
    });
    const routineId = created.json<{ allowed: true; routineId: string }>().routineId;

    const listed = await harness.app.inject({
      method: "POST",
      url: "/internal/tools/list_routines",
      headers: { "x-openbot-session": token },
      payload: {},
    });
    expect(listed.json<{ routines: Array<{ id: string }> }>().routines[0]?.id).toBe(routineId);
  });
});

describe("McpComposer", () => {
  it("omits create_bot from non-CoS tool lists", () => {
    const worker = makeBot({ name: "W", slug: "w", isChiefOfStaff: false });
    const cos = makeBot({ name: "C", slug: "c", isChiefOfStaff: true });
    expect(McpComposer.toolsForBot(worker)).not.toContain("create_bot");
    expect(McpComposer.toolsForBot(cos)).toContain("create_bot");
  });

  it("snapshots tool input schemas", () => {
    expect(
      OPENBOT_TOOL_DEFINITIONS.map((tool) => ({
        name: tool.name,
        required: (tool.inputSchema as { required?: string[] }).required ?? [],
      })),
    ).toMatchSnapshot();
  });

  it("builds openbot MCP server spec with session env", async () => {
    harness = await createMcpTestHarness();
    const cos = makeBot({ id: newId("bot"), name: "CoS", slug: "cos", isChiefOfStaff: true });
    const { servers, tools } = await McpComposer.forTurnAsync(harness.tokens, {
      bot: cos,
      turnId: newId("turn"),
      chainId: newId("chain"),
      mode: "live",
      harnessUrl: "http://127.0.0.1:3847",
    });
    expect(tools).toContain("create_bot");
    expect(servers[0]?.env?.OPENBOT_SESSION_TOKEN).toBeTruthy();
    expect(servers[0]?.env?.OPENBOT_COS_TOOLS).toBe("1");
  });
});
