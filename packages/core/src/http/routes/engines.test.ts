import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { CustomEngineSpec } from "../../context.js";
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
  let saved: CustomEngineSpec[] = [];
  ctx.engineStatuses = {
    claude: { installed: true, login: { ok: true }, apiKey: { ok: false } },
    cursor: { installed: true, login: { ok: false }, apiKey: { ok: false } },
  };
  ctx.engineDescriptors = {
    cursor: {
      id: "cursor",
      label: "Cursor",
      kind: "acp",
      loginCommand: "cursor-agent login",
      capabilities: { resume: true, steer: false },
    },
    gemini: {
      id: "gemini",
      label: "Gemini CLI",
      kind: "acp",
      capabilities: { resume: true, steer: false },
    },
  };
  ctx.availableEngines = ["claude"];
  ctx.customEngines = {
    list: () => saved,
    save: async (engines) => {
      saved = engines;
    },
  };
  app = await buildServer(ctx);
  return { app, saved: () => saved };
}

describe("engine routes", () => {
  it("lists every known engine with its status and descriptor", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/engines" });
    const engines = (res.json() as { engines: Array<Record<string, unknown>> }).engines;
    expect(engines.find((e) => e.id === "cursor")).toMatchObject({
      installed: true,
      available: false,
      login: { ok: false },
      descriptor: { loginCommand: "cursor-agent login" },
    });
    // Known but not detected at all: shown as not installed.
    expect(engines.find((e) => e.id === "gemini")).toMatchObject({ installed: false });
    expect(engines.find((e) => e.id === "claude")).toMatchObject({ available: true });
  });

  it("saves custom ACP engines and asks for a restart", async () => {
    const { app, saved } = await setup();
    const res = await app.inject({
      method: "PUT",
      url: "/api/engines/custom",
      payload: { engines: [{ slug: "goose", label: "Goose", command: "goose", args: ["acp"] }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ restartRequired: true });
    expect(saved()).toEqual([{ slug: "goose", label: "Goose", command: "goose", args: ["acp"] }]);
    const listed = await app.inject({ method: "GET", url: "/api/engines/custom" });
    expect(listed.json()).toEqual({ engines: saved() });
  });

  it("rejects invalid custom engines", async () => {
    const { app } = await setup();
    for (const engines of [
      [{ slug: "Bad Slug", label: "x", command: "y", args: [] }],
      [{ slug: "ok", label: "", command: "y", args: [] }],
      [{ slug: "ok", label: "x", command: "", args: [] }],
      [{ slug: "ok", label: "x", command: "y", args: [1] }],
      [
        { slug: "ok", label: "x", command: "y", args: [] },
        { slug: "ok", label: "z", command: "y", args: [] },
      ],
      "nope",
    ]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/engines/custom",
        payload: { engines },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
