import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";
import { createTestContext, type TestContext } from "../test-helpers.js";

let test: TestContext | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  await test?.cleanup();
  app = undefined;
  test = undefined;
});

async function boot(): Promise<FastifyInstance> {
  test = await createTestContext();
  app = await buildServer(test.ctx);
  return app;
}

describe("new Bot defaults (D-028)", () => {
  it("a Bot created without settings has Full permissions and the virtual machine", async () => {
    const server = await boot();
    const res = await server.inject({
      method: "POST",
      url: "/api/bots",
      payload: { name: "Plain" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().bot).toMatchObject({ permissionPreset: "full", computer: "docker" });
  });

  it("settings given at creation win over the defaults", async () => {
    const server = await boot();
    const res = await server.inject({
      method: "POST",
      url: "/api/bots",
      payload: { name: "Careful", permissionPreset: "read_only", computer: "none" },
    });
    expect(res.json().bot).toMatchObject({ permissionPreset: "read_only", computer: "none" });
  });

  it("existing Bots keep their settings when they are edited", async () => {
    const server = await boot();
    const created = await server.inject({
      method: "POST",
      url: "/api/bots",
      payload: { name: "Old", permissionPreset: "workspace_write", computer: "none" },
    });
    const id = created.json().bot.id as string;
    const patched = await server.inject({
      method: "PATCH",
      url: `/api/bots/${id}`,
      payload: { description: "renamed" },
    });
    expect(patched.json().bot).toMatchObject({
      permissionPreset: "workspace_write",
      computer: "none",
    });
  });
});
