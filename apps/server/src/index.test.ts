import { describe, expect, it, afterEach } from "vitest";
import { createServer, SERVER_VERSION } from "./index.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("apps/server", () => {
  it("GET /health returns ok", async () => {
    app = createServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/harness/status reports the harness as connected", async () => {
    app = createServer();
    const res = await app.inject({ method: "GET", url: "/api/harness/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ connected: true, version: SERVER_VERSION });
  });
});
