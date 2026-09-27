import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "@openbot/core";
import { buildOAuthCallbackUrl, buildOpenBotOAuthDeepLink } from "./oauth.js";
import { MockComposioClient } from "./composio/mock-client.js";
import { createConnectorTestContext, type ConnectorTestContext } from "./test-helpers.js";
import { connectionOAuthStateKey } from "./vault-keys.js";

let testCtx: ConnectorTestContext | undefined;

afterEach(async () => {
  await testCtx?.cleanup();
  testCtx = undefined;
});

describe("Composio OAuth callback", () => {
  it("returns a pending authUrl and completes via loopback callback", async () => {
    const composioClient = new MockComposioClient("composio_test_key_12345678", {
      oauthToolkits: ["gmail"],
    });
    testCtx = await createConnectorTestContext({ composioClient });

    const pending = await testCtx.service.connect({ provider: "composio", appId: "gmail" });
    expect(pending.authUrl).toBeDefined();

    const row = testCtx.ctx.repos.connections.getById(pending.connectionId);
    expect(row?.status).toBe("disconnected");

    const state = await testCtx.ctx.vault.get(connectionOAuthStateKey(pending.connectionId));
    expect(state).toBeTruthy();

    const app = await buildServer(testCtx.ctx);
    try {
      const callbackUrl = buildOAuthCallbackUrl(
        testCtx.ctx.config.port,
        pending.connectionId,
        state!,
      );
      const url = new URL(callbackUrl);
      const res = await app.inject({
        method: "GET",
        url: `${url.pathname}${url.search}`,
        remoteAddress: "127.0.0.1",
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toContain(buildOpenBotOAuthDeepLink(pending.connectionId));

      const connected = testCtx.ctx.repos.connections.getById(pending.connectionId);
      expect(connected?.status).toBe("connected");
      expect(Object.keys(connected?.toolMeta ?? {}).length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("rejects oauth callback from non-loopback addresses", async () => {
    testCtx = await createConnectorTestContext();
    const app = await buildServer(testCtx.ctx);
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/connectors/oauth/callback?connectionId=con_test&state=abc",
        remoteAddress: "203.0.113.5",
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("completes OAuth via authenticated deep-link API", async () => {
    const composioClient = new MockComposioClient("composio_test_key_12345678", {
      oauthToolkits: ["gmail"],
    });
    testCtx = await createConnectorTestContext({ composioClient });

    const pending = await testCtx.service.connect({ provider: "composio", appId: "gmail" });
    const state = await testCtx.ctx.vault.get(connectionOAuthStateKey(pending.connectionId));

    const app = await buildServer(testCtx.ctx);
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/connectors/${pending.connectionId}/oauth/complete`,
        payload: { state },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ connection: { status: string } }>();
      expect(body.connection.status).toBe("connected");
    } finally {
      await app.close();
    }
  });
});
