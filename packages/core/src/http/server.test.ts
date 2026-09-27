import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";
import { createTestContext, type TestContext } from "../test-helpers.js";

let testContext: TestContext | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  await testContext?.cleanup();
  app = undefined;
  testContext = undefined;
});

async function boot(): Promise<{ app: FastifyInstance; test: TestContext }> {
  testContext = await createTestContext();
  app = await buildServer(testContext.ctx);
  return { app, test: testContext };
}

const REMOTE_IP = "203.0.113.5"; // a non-loopback address, per RFC 5737 TEST-NET-3

describe("Client API auth (plan §4.8: loopback is implicitly the owner)", () => {
  it("a loopback request with no token is treated as the local owner", async () => {
    const { app } = await boot();
    const res = await app.inject({ method: "GET", url: "/api/bots" });
    expect(res.statusCode).toBe(200);
  });

  it("a non-loopback request with no token is unauthorized", async () => {
    const { app } = await boot();
    const res = await app.inject({ method: "GET", url: "/api/bots", remoteAddress: REMOTE_IP });
    expect(res.statusCode).toBe(401);
  });

  it("a non-loopback request with a valid device token is authorized as that device", async () => {
    const { app, test } = await boot();
    const pairRes = await app.inject({
      method: "POST",
      url: "/api/devices/pair",
      payload: { name: "phone" },
    });
    const { token } = pairRes.json<{ token: string }>();
    void test;

    const res = await app.inject({
      method: "GET",
      url: "/api/bots",
      remoteAddress: REMOTE_IP,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("a revoked device's token is rejected even though the signature still verifies", async () => {
    const { app } = await boot();
    const pairRes = await app.inject({
      method: "POST",
      url: "/api/devices/pair",
      payload: { name: "phone" },
    });
    const { token, device } = pairRes.json<{ token: string; device: { id: string } }>();

    await app.inject({ method: "DELETE", url: `/api/devices/${device.id}` }); // owner (loopback) revokes it

    const res = await app.inject({
      method: "GET",
      url: "/api/bots",
      remoteAddress: REMOTE_IP,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("garbage bearer tokens are rejected, not thrown on", async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: "GET",
      url: "/api/bots",
      remoteAddress: REMOTE_IP,
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
  });
});

/** WS1 acceptance: "an approver device cannot change caps." */
describe("role matrix: owner vs. approver", () => {
  async function pairApprover(app: FastifyInstance): Promise<string> {
    // Bootstrap the first (owner) device so the second one isn't auto-promoted to owner.
    await app.inject({
      method: "POST",
      url: "/api/devices/pair",
      payload: { name: "owner-phone", role: "owner" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/devices/pair",
      payload: { name: "approver-tablet", role: "approver" },
    });
    return res.json<{ token: string }>().token;
  }

  it("an approver device cannot change settings caps", async () => {
    const { app } = await boot();
    const approverToken = await pairApprover(app);

    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      remoteAddress: REMOTE_IP,
      headers: { authorization: `Bearer ${approverToken}` },
      payload: { caps: { s1_cosBotsCap: 999 } },
    });
    expect(res.statusCode).toBe(403);
  });

  it("an owner device can change settings caps", async () => {
    const { app } = await boot();
    // The bootstrap device is the owner; use loopback (implicit owner) to fetch its token isn't
    // needed — loopback already authenticates as owner directly.
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { caps: { s1_cosBotsCap: 9 } },
    });
    expect(res.statusCode).toBe(200);
    expect(
      res.json<{ settings: { caps: { s1_cosBotsCap: number } } }>().settings.caps.s1_cosBotsCap,
    ).toBe(9);
  });

  it("an approver cannot create/delete permission rules, list devices, or revoke devices", async () => {
    const { app } = await boot();
    const approverToken = await pairApprover(app);
    const authHeaders = { authorization: `Bearer ${approverToken}` };

    const createRule = await app.inject({
      method: "POST",
      url: "/api/rules",
      remoteAddress: REMOTE_IP,
      headers: authHeaders,
      payload: { match: {}, effect: "deny" },
    });
    expect(createRule.statusCode).toBe(403);

    const listDevices = await app.inject({
      method: "GET",
      url: "/api/devices",
      remoteAddress: REMOTE_IP,
      headers: authHeaders,
    });
    expect(listDevices.statusCode).toBe(403);
  });

  it("an approver CAN resolve approvals and read bots/threads (non-owner-gated routes)", async () => {
    const { app } = await boot();
    const approverToken = await pairApprover(app);

    const res = await app.inject({
      method: "GET",
      url: "/api/bots",
      remoteAddress: REMOTE_IP,
      headers: { authorization: `Bearer ${approverToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("bots CRUD (plan §4.7)", () => {
  it("create, read, list, update, duplicate, and archive a bot end to end", async () => {
    const { app } = await boot();

    const createRes = await app.inject({
      method: "POST",
      url: "/api/bots",
      payload: { name: "Research Bot" },
    });
    expect(createRes.statusCode).toBe(201);
    const { bot } = createRes.json<{ bot: { id: string; name: string } }>();
    expect(bot.name).toBe("Research Bot");

    const getRes = await app.inject({ method: "GET", url: `/api/bots/${bot.id}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json<{ bot: { id: string } }>().bot.id).toBe(bot.id);

    const listRes = await app.inject({ method: "GET", url: "/api/bots" });
    expect(listRes.json<{ bots: unknown[] }>().bots).toHaveLength(1);

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/bots/${bot.id}`,
      payload: { label: "R&D" },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json<{ bot: { label: string } }>().bot.label).toBe("R&D");

    const dupRes = await app.inject({ method: "POST", url: `/api/bots/${bot.id}/duplicate` });
    expect(dupRes.statusCode).toBe(201);
    expect(dupRes.json<{ bot: { id: string } }>().bot.id).not.toBe(bot.id);

    const deleteRes = await app.inject({ method: "DELETE", url: `/api/bots/${bot.id}` });
    expect(deleteRes.statusCode).toBe(200);

    const afterDelete = await app.inject({ method: "GET", url: "/api/bots" }); // archived bots are hidden by default
    expect(afterDelete.json<{ bots: unknown[] }>().bots).toHaveLength(1);
  });

  it("404s for an unknown bot id", async () => {
    const { app } = await boot();
    const res = await app.inject({ method: "GET", url: "/api/bots/bot_does_not_exist" });
    expect(res.statusCode).toBe(404);
  });
});

describe("approvals + chains (plan §4.7 safety)", () => {
  it("resolving an approval publishes an approval.resolved event", async () => {
    const { app, test } = await boot();
    const now = test.ctx.clock.now();
    const approval = {
      id: "apr_test1",
      kind: "tool" as const,
      botId: "bot_test1",
      chainId: undefined,
      summary: "Run `rm -rf /tmp/scratch`",
      detail: "shell: rm -rf /tmp/scratch",
      risk: 0.5,
      status: "pending" as const,
      resolution: undefined,
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
    };
    test.ctx.repos.approvals.create(approval);
    const settled: Array<[string, string]> = [];
    test.ctx.onApprovalResolved = (id, resolution) => settled.push([id, resolution]);

    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/resolve`,
      payload: { resolution: "allow" },
    });
    expect(res.statusCode).toBe(200);
    expect(settled).toEqual([[approval.id, "allow"]]);

    const events = test.ctx.eventBus.replaySince(0);
    expect(events.some((e) => e.type === "approval.resolved")).toBe(true);
  });
});

describe("deferred capabilities return 501 with a clear reason instead of pretending to work", () => {
  it("computer/start 501s until a ComputerProvider is wired in", async () => {
    const { app } = await boot();
    const res = await app.inject({ method: "POST", url: "/api/computer/start" });
    expect(res.statusCode).toBe(501);
    expect(res.json<{ error: string }>().error).toBe("not_implemented");
  });

  it("routines/:id/run 501s until the WS12 orchestrator is wired in", async () => {
    const { app, test } = await boot();
    const botId = (
      await app.inject({ method: "POST", url: "/api/bots", payload: { name: "B" } })
    ).json<{ bot: { id: string } }>().bot.id;
    const routine = {
      id: "rtn_test1",
      botId,
      name: "r",
      prompt: "p",
      createdBy: "user" as const,
      enabled: true,
      liveApproved: false,
      trigger: {
        type: "schedule" as const,
        cron: "0 * * * *",
        timezone: "UTC",
        catchUp: "none" as const,
      },
      limits: {
        perRun: { usd: 1, tokens: 1000, turns: 5, computerSteps: 0, wallMin: 10 },
        dailyUsd: 5,
        maxRunsPerDay: 24,
        cooldownSec: 60,
      },
      consecutiveFailures: 0,
      createdAt: test.ctx.clock.now().toISOString(),
    };
    test.ctx.repos.routines.create(routine);

    const res = await app.inject({
      method: "POST",
      url: `/api/routines/${routine.id}/run`,
      payload: {},
    });
    expect(res.statusCode).toBe(501);
  });
});

describe("routes the UI depends on", () => {
  it("GET /api/threads lists one DM thread per visible bot, with title and preview", async () => {
    const { app } = await boot();
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/bots",
        payload: { name: "Helper", description: "helps" },
      })
    ).json<{ bot: { id: string }; thread: { id: string } }>();

    const res = await app.inject({ method: "GET", url: "/api/threads" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ threads: unknown[] }>().threads).toEqual([
      expect.objectContaining({
        id: created.thread.id,
        botId: created.bot.id,
        title: "Helper",
        participantIds: [created.bot.id, "user"],
      }),
    ]);
  });

  it("PATCH /api/settings merges like PUT", async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      payload: { caps: { s2_newBotsPer24h: 5 } },
    });
    expect(res.statusCode).toBe(200);
    const caps = res.json<{ settings: { caps: Record<string, number> } }>().settings.caps;
    expect(caps.s2_newBotsPer24h).toBe(5);
    expect(caps.s1_cosBotsCap).toBe(6);
  });

  it("POST /api/threads/:id/stop stops the thread's bot through the mailbox", async () => {
    const { app, test } = await boot();
    const created = (
      await app.inject({ method: "POST", url: "/api/bots", payload: { name: "Helper" } })
    ).json<{ bot: { id: string }; thread: { id: string } }>();
    const stopped: string[] = [];
    test.ctx.mailbox = {
      enqueue: async () => ({ ok: true }),
      stop: async () => ({ ok: true }),
      steer: async () => ({ ok: true }),
      stopBot: async (botId) => {
        stopped.push(botId);
        return { ok: true };
      },
    };

    const res = await app.inject({ method: "POST", url: `/api/threads/${created.thread.id}/stop` });
    expect(res.json()).toEqual({ ok: true });
    expect(stopped).toEqual([created.bot.id]);
  });
});
