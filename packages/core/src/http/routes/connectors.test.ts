import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ConnectionView } from "@openbot/contracts";
import { buildServer } from "../server.js";
import { ConnectorError, type ConnectorService } from "../../connector-service.js";
import { createTestContext, type TestContext } from "../../test-helpers.js";

let testContext: TestContext | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  await testContext?.cleanup();
  app = undefined;
  testContext = undefined;
});

const CONNECTION: ConnectionView = {
  id: "connection_1",
  catalogId: "curated:time",
  name: "Time",
  status: "connected",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function fakeService(calls: unknown[]): ConnectorService {
  return {
    catalog: async (source, q) => {
      calls.push({ source, q });
      return source === "community" ? { entries: [], error: "offline" } : { entries: [] };
    },
    connect: async (input) => {
      calls.push(input);
      if (input.catalogId === "curated:notion") {
        throw new ConnectorError("oauth_not_supported_yet", "coming soon", 409);
      }
      if (input.catalogId === "curated:github") {
        throw new ConnectorError("missing_fields", "Missing GITHUB_TOKEN", 400, ["GITHUB_TOKEN"]);
      }
      return CONNECTION;
    },
    listConnections: () => [CONNECTION],
    disconnect: async (id) => id === CONNECTION.id,
    mcpServersForBot: async () => [],
    classifyTool: () => undefined,
  };
}

async function setup(wired = true) {
  testContext = await createTestContext();
  const calls: unknown[] = [];
  if (wired) testContext.ctx.connectorService = fakeService(calls);
  app = await buildServer(testContext.ctx);
  return { app, calls };
}

describe("connector routes", () => {
  it("answers 501 until connectors are wired", async () => {
    const { app } = await setup(false);
    const res = await app.inject({ method: "GET", url: "/api/connectors/catalog" });
    expect(res.statusCode).toBe(501);
  });

  it("passes source and q to the catalogue, defaulting to curated", async () => {
    const { app, calls } = await setup();
    await app.inject({ method: "GET", url: "/api/connectors/catalog" });
    const community = await app.inject({
      method: "GET",
      url: "/api/connectors/catalog?source=community&q=git",
    });
    expect(calls).toEqual([
      { source: "curated", q: "" },
      { source: "community", q: "git" },
    ]);
    expect(community.json()).toEqual({ entries: [], error: "offline" });
  });

  it("maps connect results and ConnectorErrors", async () => {
    const { app, calls } = await setup();
    const ok = await app.inject({
      method: "POST",
      url: "/api/connectors/connect",
      payload: { catalogId: "curated:time", displayName: "Clock" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toEqual({ connection: CONNECTION });
    expect(calls[0]).toEqual({ catalogId: "curated:time", values: {}, displayName: "Clock" });

    const oauth = await app.inject({
      method: "POST",
      url: "/api/connectors/connect",
      payload: { catalogId: "curated:notion", values: {} },
    });
    expect(oauth.statusCode).toBe(409);
    expect(oauth.json()).toEqual({ error: "oauth_not_supported_yet", reason: "coming soon" });

    const missing = await app.inject({
      method: "POST",
      url: "/api/connectors/connect",
      payload: { catalogId: "curated:github", values: {} },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().fields).toEqual(["GITHUB_TOKEN"]);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/connectors/connect",
      payload: { catalogId: "", values: { A: 1 } },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("lists and deletes connections", async () => {
    const { app } = await setup();
    const list = await app.inject({ method: "GET", url: "/api/connectors/connections" });
    expect(list.json()).toEqual({ connections: [CONNECTION] });
    const del = await app.inject({
      method: "DELETE",
      url: `/api/connectors/connections/${CONNECTION.id}`,
    });
    expect(del.statusCode).toBe(200);
    const missing = await app.inject({
      method: "DELETE",
      url: "/api/connectors/connections/nope",
    });
    expect(missing.statusCode).toBe(404);
  });
});
