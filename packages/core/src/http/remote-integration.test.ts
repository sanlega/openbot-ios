import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ClientE2ESession,
  computeSharedSecret,
  deriveFramingKey,
  generateX25519KeyPair,
} from "@openbot/remote";
import { buildServer } from "./server.js";
import { createTestContext, type TestContext } from "../test-helpers.js";

const REMOTE_IP = "203.0.113.5";

let testContext: TestContext | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  await testContext?.cleanup();
  app = undefined;
  testContext = undefined;
});

async function boot(): Promise<{ app: FastifyInstance; test: TestContext }> {
  testContext = await createTestContext();
  app = await buildServer(testContext.ctx);
  return { app, test: testContext };
}

describe("WS11 remote pairing integration", () => {
  it("completes QR pairing and serves the PWA shell", async () => {
    const { app } = await boot();
    await app.inject({ method: "POST", url: "/api/devices/pair", payload: { name: "owner", role: "owner" } });

    const qr = await app.inject({ method: "POST", url: "/api/devices/pair/qr" });
    expect(qr.statusCode).toBe(200);
    const payload = qr.json<{ pairSecret: string; hostPub: string; urls: string[] }>();

    const deviceKeys = generateX25519KeyPair();
    const complete = await app.inject({
      method: "POST",
      url: "/api/devices/pair/complete",
      remoteAddress: REMOTE_IP,
      payload: {
        pairSecret: payload.pairSecret,
        devicePub: deviceKeys.publicKeyBase64,
        name: "phone",
        via: "lan",
      },
    });
    expect(complete.statusCode).toBe(201);
    const body = complete.json<{ token: string; e2e: { serverHeader: string } }>();
    expect(body.token).toMatch(/^dev_/);

    const pwa = await app.inject({ method: "GET", url: "/app/" });
    expect(pwa.statusCode).toBe(200);
    expect(pwa.body).toContain("OpenBot Phone");
  });

  it("encrypts remote HTTP responses so a proxy capture cannot read them", async () => {
    const { app, test } = await boot();
    await app.inject({ method: "POST", url: "/api/devices/pair", payload: { name: "owner", role: "owner" } });
    const qr = await app.inject({ method: "POST", url: "/api/devices/pair/qr" });
    const { pairSecret } = qr.json<{ pairSecret: string }>();
    const deviceKeys = generateX25519KeyPair();
    const complete = await app.inject({
      method: "POST",
      url: "/api/devices/pair/complete",
      remoteAddress: REMOTE_IP,
      payload: { pairSecret, devicePub: deviceKeys.publicKeyBase64, name: "phone", via: "lan" },
    });
    const { token, e2e } = complete.json<{ token: string; e2e: { serverHeader: string } }>();

    const hostPrivate = test.ctx.remote!.hostKeys.privateKey;
    const framingKey = deriveFramingKey(computeSharedSecret(hostPrivate, deviceKeys.publicKeyBase64));
    const client = await ClientE2ESession.create(framingKey, e2e.serverHeader);

    const proxied = await app.inject({
      method: "GET",
      url: "/api/bots",
      remoteAddress: REMOTE_IP,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(proxied.statusCode).toBe(200);
    expect(proxied.body).not.toContain("bots");
    const decrypted = await client.decryptResponse(proxied.body);
    expect(JSON.parse(decrypted.toString("utf8"))).toHaveProperty("bots");
  });
});
