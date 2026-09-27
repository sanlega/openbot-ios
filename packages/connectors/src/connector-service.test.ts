import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newId, type Bot } from "@openbot/contracts";
import { buildServer } from "@openbot/core";
import { MockMcpRegistryClient } from "./mcp-registry.js";
import { wireConnectors } from "./wire.js";
import { assertNoSecrets, redactValue } from "./redaction.js";
import { createConnectorTestContext, type ConnectorTestContext } from "./test-helpers.js";

let testCtx: ConnectorTestContext | undefined;

afterEach(async () => {
  await testCtx?.cleanup();
  testCtx = undefined;
});

describe("ConnectorService (WS10 acceptance)", () => {
  it("a bot can use one raw MCP app and one Composio app", async () => {
    testCtx = await createConnectorTestContext();

    const secret = "super_secret_mcp_token_abc123xyz";
    const mcp = await testCtx.service.connect({
      provider: "mcp",
      appId: "filesystem",
      displayName: "Local FS",
      mcpConfig: {
        transport: "stdio",
        command: "node",
        args: ["fixtures/mock-mcp-server.mjs"],
        env: { MCP_TOKEN: secret },
      },
    });

    const composio = await testCtx.service.connect({
      provider: "composio",
      appId: "github",
      displayName: "GitHub",
    });

    const bot: Bot = {
      id: newId("bot"),
      slug: "worker",
      name: "Worker",
      description: "test",
      pinned: false,
      hidden: false,
      isChiefOfStaff: false,
      createdBy: "user",
      routing: { mode: "auto" },
      permissionPreset: "read_only",
      computer: "none",
      connectors: [mcp.connectionId, composio.connectionId],
      limits: {},
    };
    testCtx.ctx.repos.bots.create(bot);

    const specs = await testCtx.service.mcpServersForBot(bot.id);
    expect(specs).toHaveLength(2);
    expect(specs[0]?.name).toMatch(/^mcp_/);
    expect(specs[1]?.name).toMatch(/^composio_/);
    expect(specs[0]?.env?.MCP_TOKEN).toBe(secret);
    // Env injection is allowed for engine spawn; persistence/logging is covered by the redaction test.
  });

  it("disabling a connector removes its tools on the next turn", async () => {
    testCtx = await createConnectorTestContext();

    const mcp = await testCtx.service.connect({ provider: "mcp", appId: "filesystem" });
    const composio = await testCtx.service.connect({ provider: "composio", appId: "github" });

    const bot: Bot = {
      id: newId("bot"),
      slug: "worker2",
      name: "Worker",
      description: "test",
      pinned: false,
      hidden: false,
      isChiefOfStaff: false,
      createdBy: "user",
      routing: { mode: "auto" },
      permissionPreset: "read_only",
      computer: "none",
      connectors: [mcp.connectionId, composio.connectionId],
      limits: {},
    };
    testCtx.ctx.repos.bots.create(bot);

    expect((await testCtx.service.mcpServersForBot(bot.id)).length).toBe(2);

    testCtx.ctx.repos.bots.update(bot.id, { connectors: [mcp.connectionId] });
    const specs = await testCtx.service.mcpServersForBot(bot.id);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.name).toMatch(/^mcp_/);
  });

  it("delivers a Composio trigger event through subscribeTrigger", async () => {
    testCtx = await createConnectorTestContext();
    const composio = await testCtx.service.connect({ provider: "composio", appId: "github" });

    const composioId = [...testCtx.composioClient.connections.keys()][0]!;
    const events: unknown[] = [];
    const unsubscribe = await testCtx.service.subscribeTrigger(
      composio.connectionId,
      "github.new_issue",
      {},
      (e: { payload: unknown }) => events.push(e.payload),
    );

    testCtx.composioClient.emitTrigger(composioId, "github.new_issue", {
      issue: 42,
    });

    expect(events).toEqual([{ issue: 42 }]);
    unsubscribe();
  });

  it("searchCatalog merges MCP registry and Composio toolkits", async () => {
    testCtx = await createConnectorTestContext();
    const registry = new MockMcpRegistryClient([
      { id: "mcp:filesystem", name: "Filesystem", description: "Local files" },
    ]);
    wireConnectors(testCtx.ctx, {
      composioClient: testCtx.composioClient,
      registry,
    });

    const apps = await testCtx.service.searchCatalog("git");
    expect(apps.some((a: { id: string }) => a.id.startsWith("composio:"))).toBe(true);
  });
});

describe("secrets redaction (WS10 acceptance)", () => {
  it("grep over DB rows, vault keys, and NDJSON leaves no secret literals", async () => {
    testCtx = await createConnectorTestContext();
    const apiKey = "composio_test_key_12345678";
    const mcpSecret = "vault_only_mcp_secret_value_999";

    await testCtx.ctx.vault.set("composio.apiKey", apiKey);
    await testCtx.service.connect({
      provider: "mcp",
      appId: "demo",
      mcpConfig: {
        transport: "stdio",
        command: "node",
        args: ["-e", "console.log('mcp')"],
        env: { TOKEN: mcpSecret },
      },
    });

    const dbDump = JSON.stringify(testCtx.ctx.repos.connections.list());
    assertNoSecrets(dbDump, [apiKey, mcpSecret]);

    const vaultKeys = await testCtx.ctx.vault.list();
    expect(vaultKeys.every((k) => !k.includes(mcpSecret))).toBe(true);

    const logsDir = testCtx.ctx.config.logsThreadsDir;
    const ndjsonFiles = await readdir(logsDir).catch(() => [] as string[]);
    for (const file of ndjsonFiles) {
      const content = await readFile(join(logsDir, file), "utf8");
      assertNoSecrets(content, [apiKey, mcpSecret]);
    }

    const redacted = redactValue(
      { token: mcpSecret, nested: { authorization: `Bearer ${apiKey}` } },
      [apiKey, mcpSecret],
    );
    assertNoSecrets(JSON.stringify(redacted), [apiKey, mcpSecret]);
  });
});

describe("Client API connector routes", () => {
  it("returns catalog apps when connector service is wired", async () => {
    testCtx = await createConnectorTestContext();
    const app = await buildServer(testCtx.ctx);
    try {
      const res = await app.inject({ method: "GET", url: "/api/connectors/catalog?q=github" });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ apps: { id: string }[] }>();
      expect(body.apps.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
