import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

  it("retries a request that timed out (a cold connection can miss the deadline)", async () => {
    let calls = 0;
    const slowFirst = createServer((_req, res) => {
      calls += 1;
      const reply = () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ model: "jev-test", answers: { ok: { type: "noul", noul: 0.1 } } }),
        );
      };
      if (calls === 1) setTimeout(reply, 400);
      else reply();
    });
    await new Promise<void>((resolve) => slowFirst.listen(0, "127.0.0.1", resolve));
    const { port } = slowFirst.address() as AddressInfo;
    try {
      const client = new JevClient({ apiKey: "sk-test", baseUrl: `http://127.0.0.1:${port}` });
      const result = await client.systemOne({
        state: "s",
        questions: { ok: { type: "noul", instructions: "ok?" } } as never,
        timeoutMs: 150,
      });
      expect(result.response.model).toBe("jev-test");
      expect(calls).toBe(2);
    } finally {
      slowFirst.closeAllConnections();
      await new Promise((resolve) => slowFirst.close(resolve));
    }
  });

  it("gives computer decisions a few seconds, not a few hundred ms", async () => {
    const { jevTimeoutMs } = await import("./jev-client.js");
    expect(jevTimeoutMs("computer")).toBe(3000);
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
