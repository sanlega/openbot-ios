import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadConfig, type CoreContext } from "@openbot/core";
import { createServer } from "./index.js";

let app: FastifyInstance | undefined;
let ctx: CoreContext | undefined;
let tempDir: string | undefined;

afterEach(async () => {
  await app?.close();
  ctx?.closeDb();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  app = undefined;
  ctx = undefined;
  tempDir = undefined;
});

/** Each test gets its own `OPENBOT_HOME` so parallel test files never race on the same vault/db files. */
async function isolatedOptions() {
  tempDir = await mkdtemp(join(tmpdir(), "openbot-server-test-"));
  const config = loadConfig({ env: { OPENBOT_HOME: tempDir }, overrides: { dbPath: ":memory:" } });
  return { config, disableNdjson: true };
}

describe("apps/server", () => {
  it("GET /health returns ok", async () => {
    ({ app, ctx } = await createServer(await isolatedOptions()));
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/harness/status reports the harness as connected", async () => {
    ({ app, ctx } = await createServer(await isolatedOptions()));
    const res = await app.inject({ method: "GET", url: "/api/harness/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ connected: true });
  });
});
