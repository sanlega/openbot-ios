import { afterEach, describe, expect, it } from "vitest";
import { newId, type Bot } from "@openbot/contracts";
import { buildServer } from "@openbot/core";
import { CURATED_CONNECTORS } from "./catalog/curated.js";
import { REMOTE_LAUNCHER_PATH } from "./catalog/template.js";
import { MockMcpRegistryClient, type RegistryServer } from "./mcp-registry.js";
import { createConnectorTestContext, type ConnectorTestContext } from "./test-helpers.js";

let testCtx: ConnectorTestContext | undefined;
let app: Awaited<ReturnType<typeof buildServer>> | undefined;

afterEach(async () => {
  await app?.close();
  await testCtx?.cleanup();
  app = undefined;
  testCtx = undefined;
});

const SECRET = "github_pat_do_not_leak_0123456789abcdef";

const REGISTRY: RegistryServer[] = [
  {
    name: "io.github.acme/weather",
    description: "Weather forecasts",
    version: "1.2.3",
    packages: [
      {
        registryType: "npm",
        identifier: "@acme/weather-mcp",
        version: "1.2.3",
        transport: { type: "stdio" },
        environmentVariables: [{ name: "WEATHER_API_KEY", isRequired: true, isSecret: true }],
      },
    ],
  },
];

function makeBot(connectors: string[]): Bot {
  return {
    id: newId("bot"),
    slug: `worker-${Math.random().toString(36).slice(2, 8)}`,
    name: "Worker",
    description: "test",
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    routing: { mode: "auto" },
    permissionPreset: "workspace_write",
    computer: "none",
    connectors,
    limits: {},
  };
}

async function setup(registry = new MockMcpRegistryClient(REGISTRY)) {
  testCtx = await createConnectorTestContext({ registry });
  app = await buildServer(testCtx.ctx);
  return { ...testCtx, app };
}

describe("connector routes (real service)", () => {
  it("lists the curated catalogue, filtered by q, with connected state", async () => {
    const { app } = await setup();
    const all = await app.inject({ method: "GET", url: "/api/connectors/catalog" });
    expect(all.statusCode).toBe(200);
    const entries = all.json().entries as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(CURATED_CONNECTORS.length);
    expect(entries.every((e) => e.connected === false && e.verified !== undefined)).toBe(true);
    expect(entries.some((e) => "template" in e)).toBe(false);

    const q = await app.inject({ method: "GET", url: "/api/connectors/catalog?q=github" });
    expect(q.json().entries.map((e: { id: string }) => e.id)).toContain("curated:github");
    expect(q.json().entries.length).toBeLessThan(entries.length);

    const connect = await app.inject({
      method: "POST",
      url: "/api/connectors/connect",
      payload: { catalogId: "curated:time", values: {} },
    });
    expect(connect.statusCode).toBe(201);
    const after = await app.inject({ method: "GET", url: "/api/connectors/catalog?q=time" });
    const time = after.json().entries.find((e: { id: string }) => e.id === "curated:time");
    expect(time).toMatchObject({ connected: true, connectionId: connect.json().connection.id });
  });

  it("connects a token entry with the secret only in the vault, and disconnects it", async () => {
    const { app, ctx } = await setup();
    const events: Array<{ type: string; payload: unknown }> = [];
    ctx.eventBus.subscribe((e) => void events.push(e));

    const missing = await app.inject({
      method: "POST",
      url: "/api/connectors/connect",
      payload: { catalogId: "curated:github", values: {} },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: "missing_fields", fields: ["GITHUB_TOKEN"] });

    const res = await app.inject({
      method: "POST",
      url: "/api/connectors/connect",
      payload: { catalogId: "curated:github", values: { GITHUB_TOKEN: SECRET } },
    });
    expect(res.statusCode).toBe(201);
    const connection = res.json().connection;
    expect(connection).toEqual({
      id: expect.any(String),
      catalogId: "curated:github",
      name: "GitHub",
      status: "connected",
      createdAt: expect.any(String),
    });

    const list = await app.inject({ method: "GET", url: "/api/connectors/connections" });
    expect(list.json()).toEqual({ connections: [connection] });

    // The token is in the vault and nowhere else (DB row, API, events).
    expect(await ctx.vault.get(`connection.${connection.id}.env.GITHUB_TOKEN`)).toBe(SECRET);
    expect(JSON.stringify(ctx.repos.connections.list())).not.toContain(SECRET);
    expect(list.body).not.toContain(SECRET);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(events.map((e) => e.type)).toContain("connector.connected");

    const bot = makeBot([connection.id]);
    ctx.repos.bots.create(bot);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/connectors/connections/${connection.id}`,
    });
    expect(del.statusCode).toBe(200);
    expect(ctx.repos.connections.getById(connection.id)).toBeUndefined();
    expect((await ctx.vault.list()).filter((k) => k.includes(connection.id))).toEqual([]);
    expect(ctx.repos.bots.getById(bot.id)?.connectors).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["connector.disconnected", "bot.updated"]),
    );

    const again = await app.inject({
      method: "DELETE",
      url: `/api/connectors/connections/${connection.id}`,
    });
    expect(again.statusCode).toBe(404);
  });

  it("refuses OAuth-only entries and unknown ids", async () => {
    const { app } = await setup();
    const oauth = await app.inject({
      method: "POST",
      url: "/api/connectors/connect",
      payload: { catalogId: "curated:notion", values: {} },
    });
    expect(oauth.statusCode).toBe(409);
    expect(oauth.json().error).toBe("oauth_not_supported_yet");

    const unknown = await app.inject({
      method: "POST",
      url: "/api/connectors/connect",
      payload: { catalogId: "curated:nope", values: {} },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toBe("unknown_catalog_entry");

    const bad = await app.inject({ method: "POST", url: "/api/connectors/connect", payload: {} });
    expect(bad.statusCode).toBe(400);
  });

  it("lists community servers unverified and connects one", async () => {
    const { app, service, ctx } = await setup();
    const res = await app.inject({
      method: "GET",
      url: "/api/connectors/catalog?source=community&q=weather",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toHaveLength(1);
    expect(res.json().entries[0]).toMatchObject({
      id: "registry:io.github.acme/weather",
      verified: false,
      connected: false,
    });

    const connect = await app.inject({
      method: "POST",
      url: "/api/connectors/connect",
      payload: {
        catalogId: "registry:io.github.acme/weather",
        values: { WEATHER_API_KEY: "weather-key-123456" },
        displayName: "Weather",
      },
    });
    expect(connect.statusCode).toBe(201);
    const bot = makeBot([connect.json().connection.id]);
    ctx.repos.bots.create(bot);
    expect(await service.mcpServersForBot(bot.id)).toEqual([
      {
        name: "weather",
        command: "npx",
        args: ["-y", "@acme/weather-mcp@1.2.3"],
        env: { WEATHER_API_KEY: "weather-key-123456" },
      },
    ]);
    // Unknown tools of an unvetted server are writes.
    expect(service.classifyTool(bot.id, "mcp__weather__forecast")?.sideEffect).toBe(true);
  });

  it("reports a registry outage as an empty list with an error", async () => {
    const { app } = await setup(new MockMcpRegistryClient([], "network down"));
    const res = await app.inject({
      method: "GET",
      url: "/api/connectors/catalog?source=community",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toEqual([]);
    expect(res.json().error).toMatch(/network down/);

    const bad = await app.inject({ method: "GET", url: "/api/connectors/catalog?source=other" });
    expect(bad.statusCode).toBe(400);
  });

  it("PUT /api/bots/:id/connectors assigns connection ids and publishes bot.updated", async () => {
    const { app, ctx } = await setup();
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    ctx.eventBus.subscribe((e) => void events.push(e));
    const conn = (
      await app.inject({
        method: "POST",
        url: "/api/connectors/connect",
        payload: { catalogId: "curated:time", values: {} },
      })
    ).json().connection;
    const bot = makeBot([]);
    ctx.repos.bots.create(bot);

    const unknown = await app.inject({
      method: "PUT",
      url: `/api/bots/${bot.id}/connectors`,
      payload: { connectors: ["connection_missing"] },
    });
    expect(unknown.statusCode).toBe(400);

    const put = await app.inject({
      method: "PUT",
      url: `/api/bots/${bot.id}/connectors`,
      payload: { connectors: [conn.id, conn.id] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ connectors: [conn.id] });
    const updated = events.find((e) => e.type === "bot.updated");
    expect((updated?.payload.bot as Bot).connectors).toEqual([conn.id]);

    const get = await app.inject({ method: "GET", url: `/api/bots/${bot.id}/connectors` });
    expect(get.json()).toEqual({ connectors: [conn.id] });
  });
});

describe("per-Bot injection and tool classification", () => {
  it("injects only the Bot's assigned connections", async () => {
    const { service, ctx } = await setup();
    const fs = await service.connect({
      catalogId: "curated:filesystem",
      values: { FOLDER: "/tmp/shared" },
    });
    const gh = await service.connect({
      catalogId: "curated:github",
      values: { GITHUB_TOKEN: SECRET },
    });
    const ctx7 = await service.connect({ catalogId: "curated:context7", values: {} });

    const withBoth = makeBot([fs.id, gh.id, ctx7.id]);
    const withNone = makeBot([]);
    ctx.repos.bots.create(withBoth);
    ctx.repos.bots.create(withNone);

    const specs = await service.mcpServersForBot(withBoth.id);
    expect(specs.map((s) => s.name)).toEqual(["filesystem", "github", "context7"]);
    expect(specs[0]).toEqual({
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/shared"],
      env: {},
    });
    expect(specs[1]!.args).toEqual([REMOTE_LAUNCHER_PATH]);
    expect(specs[1]!.env?.OPENBOT_REMOTE_HEADER_0).toBe(`Bearer ${SECRET}`);
    // Optional key left empty: no Authorization header at all.
    expect(specs[2]!.env?.OPENBOT_REMOTE_HEADER_NAMES).toBe("");

    expect(await service.mcpServersForBot(withNone.id)).toEqual([]);
  });

  it("never gives a browser-automation server to a Bot whose computer is not this one", async () => {
    const { service, ctx } = await setup();
    const pw = await service.connect({ catalogId: "curated:playwright", values: {} });
    const time = await service.connect({ catalogId: "curated:time", values: {} });
    const vmOnly = { ...makeBot([pw.id, time.id]), computer: "docker" as const };
    const noComputer = makeBot([pw.id, time.id]);
    const local = { ...makeBot([pw.id, time.id]), computer: "docker+local" as const };
    for (const bot of [vmOnly, noComputer, local]) ctx.repos.bots.create(bot);

    // It would open Chrome on the owner's desktop instead of the virtual machine.
    expect((await service.mcpServersForBot(vmOnly.id)).map((s) => s.name)).toEqual(["time"]);
    expect((await service.mcpServersForBot(noComputer.id)).map((s) => s.name)).toEqual(["time"]);
    expect((await service.mcpServersForBot(local.id)).map((s) => s.name)).toEqual([
      "playwright",
      "time",
    ]);
  });

  it("gives two connections of the same entry distinct server names", async () => {
    const { service, ctx } = await setup();
    const a = await service.connect({ catalogId: "curated:time", values: {} });
    const b = await service.connect({ catalogId: "curated:time", values: {}, displayName: "T2" });
    const bot = makeBot([a.id, b.id]);
    ctx.repos.bots.create(bot);
    expect((await service.mcpServersForBot(bot.id)).map((s) => s.name)).toEqual(["time", "time_2"]);
    expect(service.classifyTool(bot.id, "mcp__time_2__get_current_time")?.target).toBe("T2");
  });

  it("classifies catalogue writes as side effects and reads as read-only", async () => {
    const { service, ctx } = await setup();
    const gh = await service.connect({
      catalogId: "curated:github",
      values: { GITHUB_TOKEN: SECRET },
    });
    const bot = makeBot([gh.id]);
    const other = makeBot([]);
    ctx.repos.bots.create(bot);
    ctx.repos.bots.create(other);

    expect(service.classifyTool(bot.id, "mcp__github__issue_write")).toEqual({
      kind: "connector_action",
      action: "issue_write",
      target: "GitHub",
      sideEffect: true,
      readOnly: false,
      summary: "GitHub: issue_write",
    });
    expect(service.classifyTool(bot.id, "mcp__github__list_issues")).toMatchObject({
      sideEffect: false,
      readOnly: true,
    });
    // Not in the catalogue's list: a write.
    expect(service.classifyTool(bot.id, "mcp__github__brand_new_tool")?.sideEffect).toBe(true);
    // Not a connector tool, or not this Bot's connector.
    expect(service.classifyTool(bot.id, "Bash", { command: "ls" })).toBeUndefined();
    expect(service.classifyTool(other.id, "mcp__github__issue_write")).toBeUndefined();
  });
});
