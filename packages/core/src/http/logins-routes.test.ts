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

describe("saved login routes", () => {
  it("saves a login, lists it without the password, and removes it", async () => {
    const server = await boot();
    const saved = await server.inject({
      method: "PUT",
      url: "/api/logins/www.example.com",
      payload: { username: "me@example.com", password: "hunter2" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().login).toMatchObject({
      site: "example.com",
      username: "me@example.com",
      hasPassword: true,
    });
    expect(saved.body).not.toContain("hunter2");

    const list = await server.inject({ method: "GET", url: "/api/logins" });
    expect(list.json().logins).toHaveLength(1);
    expect(list.body).not.toContain("hunter2");

    // The password is in the vault, not in any response.
    expect(await test!.ctx.vault.get("login.example.com")).toContain("hunter2");

    const removed = await server.inject({ method: "DELETE", url: "/api/logins/example.com" });
    expect(removed.json()).toEqual({ ok: true });
    expect((await server.inject({ method: "GET", url: "/api/logins" })).json().logins).toEqual([]);
    expect(
      (await server.inject({ method: "DELETE", url: "/api/logins/example.com" })).statusCode,
    ).toBe(404);
  });

  it("rejects a site that is not a website address", async () => {
    const server = await boot();
    const response = await server.inject({
      method: "PUT",
      url: "/api/logins/nope",
      payload: { username: "a", password: "b" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_login");
  });
});
