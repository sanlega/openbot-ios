import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { newId, type InputRequest } from "@openbot/contracts";
import { buildServer } from "../server.js";
import { createTestContext, type TestContext } from "../../test-helpers.js";

let testContext: TestContext | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  await testContext?.cleanup();
  app = undefined;
  testContext = undefined;
});

async function setup() {
  testContext = await createTestContext();
  const ctx = testContext.ctx;
  const turns: Array<{ botId: string; text: string; chainId?: string }> = [];
  ctx.mailbox = {
    enqueue: async (input) => {
      turns.push(input);
      return { ok: true, chainId: input.chainId };
    },
    stop: async () => ({ ok: true }),
    stopBot: async () => ({ ok: true }),
    steer: async () => ({ ok: true }),
  };
  app = await buildServer(ctx);
  const request: InputRequest = {
    id: newId("inputRequest"),
    botId: "bot_1",
    threadId: "thr_1",
    chainId: "chn_1",
    title: "Set up",
    fields: [
      { id: "name", type: "text", label: "Your name", required: true, multiline: false },
      {
        id: "tone",
        type: "choice",
        label: "Tone",
        required: false,
        options: ["Short", "Detailed"],
        multiple: false,
        allowOther: false,
      },
      { id: "api_key", type: "secret", label: "API key", required: false },
    ],
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  ctx.repos.inputRequests.create(request);
  return { ctx, app, request, turns };
}

describe("input routes", () => {
  it("answers a form: validates, keeps secrets in the vault, and gives the Bot a new turn", async () => {
    const { ctx, app, request, turns } = await setup();

    const missing = await app.inject({
      method: "POST",
      url: `/api/inputs/${request.id}/answer`,
      payload: { answers: { tone: "Short" } },
    });
    expect(missing.statusCode).toBe(400);

    const res = await app.inject({
      method: "POST",
      url: `/api/inputs/${request.id}/answer`,
      payload: { answers: { name: "Alex", tone: "Short", api_key: "sk-live-very-secret" } },
    });
    expect(res.statusCode).toBe(200);

    const stored = ctx.repos.inputRequests.getById(request.id);
    expect(stored?.status).toBe("answered");
    expect(stored?.answers?.api_key).toBe(`secret:input.${request.id}.api_key`);
    expect(await ctx.vault.get(`input.${request.id}.api_key`)).toBe("sk-live-very-secret");

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ botId: "bot_1", chainId: "chn_1" });
    expect(turns[0]!.text).toContain("Your name (name): Alex");
    expect(turns[0]!.text).not.toContain("sk-live-very-secret");
    const events = ctx.eventBus.replaySince(0);
    expect(JSON.stringify(events)).not.toContain("sk-live-very-secret");

    const again = await app.inject({
      method: "POST",
      url: `/api/inputs/${request.id}/answer`,
      payload: { answers: { name: "x" } },
    });
    expect(again.statusCode).toBe(409);
  });

  it("dismissing tells the Bot, and pending forms are listed", async () => {
    const { app, request, turns } = await setup();
    const listed = await app.inject({ method: "GET", url: "/api/inputs?status=pending" });
    expect(listed.json<{ inputs: InputRequest[] }>().inputs.map((i) => i.id)).toEqual([request.id]);

    const res = await app.inject({ method: "POST", url: `/api/inputs/${request.id}/dismiss` });
    expect(res.statusCode).toBe(200);
    expect(turns[0]!.text).toContain('dismissed your form "Set up"');
  });
});
