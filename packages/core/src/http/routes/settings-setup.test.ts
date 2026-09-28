import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { DecisionService } from "@openbot/contracts";
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

describe("POST /api/setup/validate (typesafe)", () => {
  it("runs the registered validator, so a valid key is saved and not only probed", async () => {
    testContext = await createTestContext();
    const ctx = testContext.ctx;
    ctx.decisionService = {
      validateKey: async () => ({ ok: true }),
    } as unknown as DecisionService;
    ctx.validators.typesafe = async (value) => {
      if (value) await ctx.vault.set("typesafe.apiKey", value);
      return { ok: true };
    };
    app = await buildServer(ctx);

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/validate",
      payload: { kind: "typesafe", value: "ts_test_key" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: { ok: true }, setup: { typesafe: { ok: true } } });
    expect(await ctx.vault.get("typesafe.apiKey")).toBe("ts_test_key");
  });

  it("falls back to probing the key when no validator is registered", async () => {
    testContext = await createTestContext();
    const ctx = testContext.ctx;
    ctx.decisionService = {
      validateKey: async (key: string) => ({ ok: key === "good" }),
    } as unknown as DecisionService;
    app = await buildServer(ctx);

    const res = await app.inject({
      method: "POST",
      url: "/api/setup/validate",
      payload: { kind: "typesafe", value: "bad" },
    });

    expect(res.json()).toMatchObject({ result: { ok: false } });
  });
});
