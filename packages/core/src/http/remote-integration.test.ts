import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ClientE2ESession,
  computeSharedSecret,
  deriveFramingKey,
  generateX25519KeyPair,
  openSecret,
  sealSecret,
} from "@openbot/remote";
import { randomBytes } from "node:crypto";
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
  it("rejects an unencrypted pairing payload even on loopback", async () => {
    const { app } = await boot();
    const response = await app.inject({
      method: "POST",
      url: "/api/devices/pair/complete",
      payload: { pairSecret: "secret", devicePub: "public", name: "phone" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "encrypted_pairing_required" });
  });

  it("completes QR pairing and serves the WS5 UI shell", async () => {
    const { app, test } = await boot();
    await app.inject({
      method: "POST",
      url: "/api/devices/pair",
      payload: { name: "owner", role: "owner" },
    });

    const qr = await app.inject({ method: "POST", url: "/api/devices/pair/qr" });
    expect(qr.statusCode).toBe(200);
    const payload = qr.json<{ pairSecret: string; hostPub: string; urls: string[] }>();

    const deviceKeys = generateX25519KeyPair();
    const framingKey = deriveFramingKey(
      computeSharedSecret(test.ctx.remote!.hostKeys.privateKey, deviceKeys.publicKeyBase64),
    );
    const sealed = await sealSecret(
      framingKey,
      Buffer.from(
        JSON.stringify({
          pairSecret: payload.pairSecret,
          devicePub: deviceKeys.publicKeyBase64,
          name: "phone",
          via: "lan",
        }),
      ),
    );
    const complete = await app.inject({
      method: "POST",
      url: "/api/devices/pair/complete",
      remoteAddress: REMOTE_IP,
      headers: { "x-openbot-pair-pub": deviceKeys.publicKeyBase64 },
      payload: { sealed },
    });
    expect(complete.statusCode).toBe(201);
    const body = JSON.parse(
      (await openSecret(framingKey, complete.json<{ sealed: string }>().sealed)).toString("utf8"),
    ) as { token: string; device: { id: string } };
    expect(body.token).toMatch(/^dev_/);
    expect(body.device.id).toMatch(/^dev_/);
    expect(complete.body).not.toContain(body.token);

    const pwa = await app.inject({ method: "GET", url: "/app/" });
    expect(pwa.statusCode).toBe(200);
    expect(pwa.body).toContain('id="root"');
    expect(pwa.body).toMatch(/\/app\/assets\/.+\.js/);
  });

  it("encrypts remote HTTP responses so a proxy capture cannot read them", async () => {
    const { app, test } = await boot();
    await app.inject({
      method: "POST",
      url: "/api/devices/pair",
      payload: { name: "owner", role: "owner" },
    });
    const qr = await app.inject({ method: "POST", url: "/api/devices/pair/qr" });
    const { pairSecret } = qr.json<{ pairSecret: string }>();
    const deviceKeys = generateX25519KeyPair();
    const hostPrivate = test.ctx.remote!.hostKeys.privateKey;
    const framingKey = deriveFramingKey(
      computeSharedSecret(hostPrivate, deviceKeys.publicKeyBase64),
    );
    const sealed = await sealSecret(
      framingKey,
      Buffer.from(
        JSON.stringify({
          pairSecret,
          devicePub: deviceKeys.publicKeyBase64,
          name: "phone",
          via: "lan",
        }),
      ),
    );
    const complete = await app.inject({
      method: "POST",
      url: "/api/devices/pair/complete",
      remoteAddress: REMOTE_IP,
      headers: { "x-openbot-pair-pub": deviceKeys.publicKeyBase64 },
      payload: { sealed },
    });
    const { token, device } = JSON.parse(
      (await openSecret(framingKey, complete.json<{ sealed: string }>().sealed)).toString("utf8"),
    ) as { token: string; device: { id: string } };
    const client = await ClientE2ESession.create(framingKey);
    const proof = await sealSecret(
      framingKey,
      Buffer.from(
        JSON.stringify({
          token,
          nonce: randomBytes(24).toString("base64url"),
          issuedAt: Date.now(),
        }),
      ),
    );

    const proxied = await app.inject({
      method: "GET",
      url: "/api/bots",
      remoteAddress: REMOTE_IP,
      headers: {
        "x-openbot-device": device.id,
        "x-openbot-device-token": proof,
        "x-openbot-e2e-session": "test-http-session",
      },
    });
    expect(proxied.statusCode).toBe(200);
    expect(proxied.body).not.toContain("bots");
    const decrypted = await client.decryptResponse(proxied.body);
    expect(JSON.parse(decrypted.toString("utf8"))).toHaveProperty("bots");

    const replay = await app.inject({
      method: "GET",
      url: "/api/bots",
      remoteAddress: REMOTE_IP,
      headers: {
        "x-openbot-device": device.id,
        "x-openbot-device-token": proof,
        "x-openbot-e2e-session": "test-http-session",
      },
    });
    expect(replay.statusCode).toBe(401);
  });

  it("does not downgrade sealed mobile auth to implicit local-owner auth on a loopback proxy", async () => {
    const { app, test } = await boot();
    await app.inject({
      method: "POST",
      url: "/api/devices/pair",
      payload: { name: "owner", role: "owner" },
    });
    const qr = await app.inject({ method: "POST", url: "/api/devices/pair/qr" });
    const deviceKeys = generateX25519KeyPair();
    const framingKey = deriveFramingKey(
      computeSharedSecret(test.ctx.remote!.hostKeys.privateKey, deviceKeys.publicKeyBase64),
    );
    const sealedPair = await sealSecret(
      framingKey,
      Buffer.from(
        JSON.stringify({
          pairSecret: qr.json<{ pairSecret: string }>().pairSecret,
          devicePub: deviceKeys.publicKeyBase64,
          name: "phone",
          via: "lan",
        }),
      ),
    );
    const complete = await app.inject({
      method: "POST",
      url: "/api/devices/pair/complete",
      remoteAddress: REMOTE_IP,
      headers: { "x-openbot-pair-pub": deviceKeys.publicKeyBase64 },
      payload: { sealed: sealedPair },
    });
    const paired = JSON.parse(
      (await openSecret(framingKey, complete.json<{ sealed: string }>().sealed)).toString("utf8"),
    ) as { token: string; device: { id: string } };
    const client = await ClientE2ESession.create(framingKey);
    const proof = await sealSecret(
      framingKey,
      Buffer.from(
        JSON.stringify({
          token: paired.token,
          nonce: randomBytes(24).toString("base64url"),
          issuedAt: Date.now(),
        }),
      ),
    );
    const response = await app.inject({
      method: "GET",
      url: "/api/bots",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-openbot-device": paired.device.id,
        "x-openbot-device-token": proof,
        "x-openbot-e2e-session": "loopback-test-session",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("bots");
    expect(
      JSON.parse((await client.decryptResponse(response.body)).toString("utf8")),
    ).toHaveProperty("bots");

    const invalidProof = await app.inject({
      method: "GET",
      url: "/api/bots",
      remoteAddress: "127.0.0.1",
      headers: {
        "x-openbot-device": paired.device.id,
        "x-openbot-device-token": "invalid-proof",
        "x-openbot-e2e-session": "invalid-proof-session",
      },
    });
    expect(invalidProof.statusCode).toBe(401);
  });
});

describe("encrypted WebSocket ordering", () => {
  it("keeps event frames and command results in one decryptable stream", async () => {
    const { app: server, test } = await boot();
    await server.inject({
      method: "POST",
      url: "/api/devices/pair",
      payload: { name: "owner", role: "owner" },
    });
    const qr = await server.inject({ method: "POST", url: "/api/devices/pair/qr" });
    const deviceKeys = generateX25519KeyPair();
    const framingKey = deriveFramingKey(
      computeSharedSecret(test.ctx.remote!.hostKeys.privateKey, deviceKeys.publicKeyBase64),
    );
    const complete = await server.inject({
      method: "POST",
      url: "/api/devices/pair/complete",
      remoteAddress: REMOTE_IP,
      headers: { "x-openbot-pair-pub": deviceKeys.publicKeyBase64 },
      payload: {
        sealed: await sealSecret(
          framingKey,
          Buffer.from(
            JSON.stringify({
              pairSecret: qr.json<{ pairSecret: string }>().pairSecret,
              devicePub: deviceKeys.publicKeyBase64,
              name: "phone",
              via: "lan",
            }),
          ),
        ),
      },
    });
    const paired = JSON.parse(
      (await openSecret(framingKey, complete.json<{ sealed: string }>().sealed)).toString("utf8"),
    ) as { token: string; device: { id: string } };
    const proof = await sealSecret(
      framingKey,
      Buffer.from(
        JSON.stringify({
          token: paired.token,
          nonce: randomBytes(24).toString("base64url"),
          issuedAt: Date.now(),
        }),
      ),
    );

    const address = await server.listen({ port: 0, host: "127.0.0.1" });
    const { default: WebSocket } = await import("ws");
    const socket = new WebSocket(address.replace("http://", "ws://") + "/api/ws", {
      headers: {
        "x-openbot-device": paired.device.id,
        "x-openbot-device-token": proof,
        "x-openbot-e2e-session": "ws-order-test-scope",
      },
    });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const client = await ClientE2ESession.create(framingKey);
    const received: { type: string; command?: string }[] = [];
    const failures: unknown[] = [];
    let decrypting = Promise.resolve();
    socket.on("message", (raw) => {
      decrypting = decrypting.then(async () => {
        try {
          const frame = raw.toString();
          // Frames are bare Base64: strict decoders (libsodium on iOS) reject quotes.
          if (!/^[A-Za-z0-9+/]+=*$/.test(frame))
            throw new Error(`not a bare frame: ${frame.slice(0, 12)}`);
          const clear = await client.decryptResponse(frame);
          received.push(JSON.parse(clear.toString("utf8")) as { type: string });
        } catch (error) {
          failures.push(error);
        }
      });
    });
    const sendEncrypted = async (payload: unknown) =>
      socket.send(await client.encryptRequest(Buffer.from(JSON.stringify(payload))));

    await sendEncrypted({ type: "subscribe", since: test.ctx.eventBus.latestSeq() });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const bursts = Array.from({ length: 30 }, () =>
      test.ctx.eventBus.publish({ type: "usage.recorded", payload: {} }),
    );
    await sendEncrypted({
      type: "command",
      command: "approval.resolve",
      payload: { id: "apr_missing", resolution: "allow" },
    });
    await Promise.all(bursts);

    const deadline = Date.now() + 3000;
    while (
      Date.now() < deadline &&
      !(
        received.some((item) => item.type === "command.result") &&
        received.filter((item) => item.type === "event").length >= 30
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await decrypting;
    socket.close();
    expect(failures).toEqual([]);
    expect(received.some((item) => item.type === "command.result")).toBe(true);
    expect(received.filter((item) => item.type === "event").length).toBeGreaterThanOrEqual(30);
  });
});

describe("iPhone push registration", () => {
  it("lets a paired phone register its APNs token and the owner send a test", async () => {
    const { app: server, test } = await boot();
    const { PushService, PushStore, ClientE2ESession: Session } = await import("@openbot/remote");
    await server.inject({
      method: "POST",
      url: "/api/devices/pair",
      payload: { name: "owner", role: "owner" },
    });
    const qr = await server.inject({ method: "POST", url: "/api/devices/pair/qr" });
    const keys = generateX25519KeyPair();
    const framingKey = deriveFramingKey(
      computeSharedSecret(test.ctx.remote!.hostKeys.privateKey, keys.publicKeyBase64),
    );
    const complete = await server.inject({
      method: "POST",
      url: "/api/devices/pair/complete",
      remoteAddress: REMOTE_IP,
      headers: { "x-openbot-pair-pub": keys.publicKeyBase64 },
      payload: {
        sealed: await sealSecret(
          framingKey,
          Buffer.from(
            JSON.stringify({
              pairSecret: qr.json<{ pairSecret: string }>().pairSecret,
              devicePub: keys.publicKeyBase64,
              name: "phone",
              via: "lan",
            }),
          ),
        ),
      },
    });
    const paired = JSON.parse(
      (await openSecret(framingKey, complete.json<{ sealed: string }>().sealed)).toString("utf8"),
    ) as { token: string; device: { id: string } };

    // Swap in a service whose APNs transport is a fake.
    const sent: { path: string; body: string }[] = [];
    test.ctx.remote!.push = new PushService({
      store: new PushStore(test.ctx.config.openbotHome),
      vault: test.ctx.vault,
      clock: test.ctx.clock,
      isActiveDevice: (id) => !!test.ctx.repos.devices.getById(id),
      lookups: {
        botName: () => "OpenBot",
        approval: () => undefined,
        input: () => undefined,
        message: () => undefined,
      },
      transport: async (request) => {
        sent.push(request);
        return { status: 200, body: "" };
      },
    });

    const client = await Session.create(framingKey);
    const proof = async () =>
      sealSecret(
        framingKey,
        Buffer.from(
          JSON.stringify({
            token: paired.token,
            nonce: randomBytes(24).toString("base64url"),
            issuedAt: Date.now(),
          }),
        ),
      );
    const phoneToken = "ab".repeat(32);
    const register = await server.inject({
      method: "PUT",
      url: "/api/devices/me/push",
      remoteAddress: REMOTE_IP,
      headers: {
        "x-openbot-device": paired.device.id,
        "x-openbot-device-token": await proof(),
        "x-openbot-e2e-session": "push-test-session",
        "content-type": "application/x-openbot-e2e",
      },
      payload: await client.encryptRequest(Buffer.from(JSON.stringify({ token: phoneToken }))),
    });
    expect(register.statusCode).toBe(200);
    expect(JSON.parse((await client.decryptResponse(register.body)).toString("utf8"))).toEqual({
      registered: true,
      configured: false,
    });

    const { privateKey } = await import("node:crypto").then((crypto) =>
      crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
    );
    const configure = await server.inject({
      method: "PUT",
      url: "/api/remote/push",
      payload: {
        keyP8: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        keyId: "ABC123DEFG",
        teamId: "TEAM123456",
      },
    });
    expect(configure.json()).toMatchObject({ configured: true, devices: 1 });
    expect(configure.body).not.toContain("PRIVATE KEY");

    const testPush = await server.inject({ method: "POST", url: "/api/remote/push/test" });
    expect(testPush.json()).toEqual({ sent: 1, failed: 0, reasons: [] });
    expect(sent[0]!.path).toBe(`/3/device/${phoneToken}`);

    const phoneCannotConfigure = await server.inject({
      method: "GET",
      url: "/api/remote/push",
      remoteAddress: REMOTE_IP,
    });
    expect(phoneCannotConfigure.statusCode).toBe(401);
  });
});
