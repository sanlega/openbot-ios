import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FakeJevServer } from "./fake-jev-server.js";
import { JevClient } from "./jev-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../fixtures/jev");

function readFixture(path: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, path), "utf8"));
}

describe("JevClient", () => {
  let server: FakeJevServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = new FakeJevServer({ apiKey: "sk-test" });
    ({ url: baseUrl } = await server.listen());
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns answers and x-typesafe-request-id from fake-jev", async () => {
    const client = new JevClient({ apiKey: "sk-test", baseUrl });
    const body = readFixture("choice/route.request.json") as {
      state: Record<string, unknown>;
      questions: Record<string, unknown>;
    };
    const result = await client.systemOne({
      state: body.state,
      questions: body.questions as never,
      timeoutMs: 2000,
    });

    expect(result.response.answers.route).toBeDefined();
    expect(result.requestId).toBeTruthy();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("retries 429 responses then succeeds", async () => {
    server.scheduleRateLimit(1);
    const client = new JevClient({ apiKey: "sk-test", baseUrl, maxRetries: 2 });
    const result = await client.systemOne({
      state: "test",
      questions: {
        x: { type: "noul", instructions: "?" },
      },
      timeoutMs: 5000,
    });
    expect(result.response.answers.x?.type).toBe("noul");
  });

  it("validateKey succeeds against GET /v1/models", async () => {
    const client = new JevClient({ apiKey: "sk-test", baseUrl });
    await expect(client.validateKey()).resolves.toMatchObject({ ok: true });
  });

  it("uses a 400ms timeout budget for computer purpose helper", async () => {
    const { jevTimeoutMs } = await import("./jev-client.js");
    expect(jevTimeoutMs("computer")).toBe(400);
    expect(jevTimeoutMs("route")).toBe(1500);
  });
});

describe("JevClient auth failures", () => {
  it("validateKey fails with wrong key", async () => {
    const server = new FakeJevServer({ apiKey: "sk-real" });
    const { url } = await server.listen();
    const client = new JevClient({ apiKey: "sk-wrong", baseUrl: url });
    await expect(client.validateKey()).resolves.toMatchObject({ ok: false });
    await server.close();
  });
});
