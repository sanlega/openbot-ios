import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { newId } from "@openbot/contracts";
import { lanAddresses, readNetworkPrefs, writeNetworkPrefs } from "./network-prefs.js";
import type { DeviceRole } from "@openbot/contracts";
import { E2E_CONTENT_TYPE } from "./framing.js";
import { PairingError } from "./pairing.js";
import {
  collectPairingUrls,
  createRemoteServices,
  primaryPairingHost,
  type RemoteServices,
} from "./wire.js";

declare module "fastify" {
  interface FastifyRequest {
    device?: { deviceId: string; role: DeviceRole };
    e2eActive?: boolean;
  }
}

/** Minimal surface `packages/core` needs without importing core types (avoids cycles). */
export interface RemoteCoreContext {
  clock: { now(): Date };
  config: { port: number; openbotHome: string };
  /** The address the server listens on, once it listens. */
  bindHost?: string;
  vault: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
  };
  deviceAuth: { issueToken(deviceId: string): string };
  repos: {
    devices: {
      list(): Array<{ id: string; revokedAt?: string }>;
      create(device: {
        id: string;
        name: string;
        role: DeviceRole;
        publicKey: string;
        via: "lan" | "tailscale" | "cloudflare";
        pairedAt: string;
      }): void;
      getById(id: string): { id: string; publicKey: string; revokedAt?: string } | undefined;
      touchLastSeen(id: string, at: Date): void;
    };
    setupState: {
      get(): unknown;
      patch(p: Record<string, unknown>): void;
    };
  };
  eventBus: {
    publish(input: { type: string; payload: Record<string, unknown> }): Promise<unknown>;
  };
  validators: Record<string, (value?: string) => Promise<{ ok: boolean; reason?: string }>>;
  remote?: RemoteServices;
}

export { createRemoteServices, type RemoteServices };

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLoopback(ip: string): boolean {
  return LOOPBACK.has(ip);
}

function requireOwnerDevice(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.device || request.device.role !== "owner") {
    reply.code(request.device ? 403 : 401).send({
      error: request.device ? "forbidden" : "unauthorized",
      reason: "owner device required",
    });
    return false;
  }
  return true;
}

/** Attaches WS11 services and setup validators onto an existing core context. */
export async function attachRemoteServices(
  ctx: RemoteCoreContext,
  services?: RemoteServices,
): Promise<RemoteServices> {
  const remote = services ?? (await createRemoteServices({ clock: ctx.clock, vault: ctx.vault }));
  ctx.remote = remote;
  ctx.validators.tailscale = (value) => remote.tailscale.validateKey(value);
  ctx.validators.cloudflare = (value) => remote.cloudflare.validateToken(value);
  return remote;
}

/** Registers QR pairing routes, E2E hooks, and `/app` PWA static assets. */
export async function registerRemoteIntegration(
  app: FastifyInstance,
  ctx: RemoteCoreContext,
  pwaRoot: string,
): Promise<void> {
  if (!ctx.remote) throw new Error("call attachRemoteServices() first");

  registerPairingRoutes(app, ctx);
  registerE2EHooks(app, ctx);
  await registerPwaStatic(app, pwaRoot);
}

function registerPairingRoutes(app: FastifyInstance, ctx: RemoteCoreContext): void {
  app.post("/api/devices/pair/complete", async (request, reply) => {
    const body = request.body as {
      pairSecret?: string;
      devicePub?: string;
      name?: string;
      role?: DeviceRole;
      via?: "lan" | "tailscale" | "cloudflare";
    };
    if (!body?.pairSecret || !body.devicePub || !body.name) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const result = ctx.remote!.pairing.complete({
        pairSecret: body.pairSecret,
        devicePub: body.devicePub,
        name: body.name,
        role: body.role,
        via: body.via ?? "lan",
      });

      const existingDevices = ctx.repos.devices.list();
      let role = result.role;
      if (existingDevices.length === 0) {
        role = body.role ?? "owner";
      } else if (role === "owner" && !requireOwnerDevice(request, reply)) {
        return;
      }

      const device = {
        id: newId("device"),
        name: body.name,
        role,
        publicKey: body.devicePub,
        via: body.via ?? "lan",
        pairedAt: ctx.clock.now().toISOString(),
      };
      ctx.repos.devices.create(device);
      const token = ctx.deviceAuth.issueToken(device.id);
      ctx.remote!.framing.rememberFramingKey(device.id, result.framingKey);
      const session = await ctx.remote!.framing.ensureSession(device.id, result.framingKey);
      await ctx.eventBus.publish({
        type: "device.paired",
        payload: { deviceId: device.id, via: device.via },
      });
      reply.code(201);
      return {
        device,
        token,
        e2e: { serverHeader: session.getResponseHeaderBase64() },
      };
    } catch (error) {
      if (error instanceof PairingError) {
        return reply.code(400).send({ error: error.code, reason: error.message });
      }
      throw error;
    }
  });

  // "Allow phones on this Wi-Fi": the owner's choice, applied when the server
  // (re)starts, since that's when it picks the address it listens on.
  const lanState = () => {
    const enabled = readNetworkPrefs(ctx.config.openbotHome).lanAccess;
    const active = ctx.bindHost === "0.0.0.0";
    return {
      enabled,
      active,
      restartRequired: enabled !== active,
      canRestart: process.env.OPENBOT_SUPERVISED === "1",
      addresses: lanAddresses().map((ip) => `http://${ip}:${ctx.config.port}`),
    };
  };

  app.get("/api/remote/lan", async (request, reply) => {
    if (!requireOwnerDevice(request, reply)) return;
    return lanState();
  });

  app.put("/api/remote/lan", async (request, reply) => {
    if (!requireOwnerDevice(request, reply)) return;
    const enabled = (request.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== "boolean") return reply.code(400).send({ error: "enabled_required" });
    await writeNetworkPrefs(ctx.config.openbotHome, { lanAccess: enabled });
    await ctx.eventBus.publish({ type: "remote.status", payload: { lanAccess: enabled } });
    return lanState();
  });

  app.post("/api/harness/restart", async (request, reply) => {
    if (!requireOwnerDevice(request, reply)) return;
    // Only when a supervisor (the desktop app) will start the harness again.
    if (process.env.OPENBOT_SUPERVISED !== "1") {
      return reply.code(409).send({ error: "not_supervised", reason: "restart OpenBot yourself" });
    }
    setTimeout(() => process.exit(0), 300).unref?.();
    return { restarting: true };
  });

  app.post("/api/devices/pair/qr", async (request, reply) => {
    if (!requireOwnerDevice(request, reply)) return;
    const ts = await ctx.remote!.tailscale.status();
    const cf = ctx.remote!.cloudflare.status();
    // Listening on the local network: phones on this Wi-Fi can reach these.
    const lan = ctx.bindHost === "0.0.0.0" ? lanAddresses() : [];
    const urls = collectPairingUrls({
      port: ctx.config.port,
      tailscaleUrls: ts.serveUrls,
      cloudflareHostname: cf.hostname,
      lanHost: lan[0] ? `${lan[0]}:${ctx.config.port}` : undefined,
    });
    for (const ip of lan.slice(1)) urls.splice(1, 0, `http://${ip}:${ctx.config.port}`);
    const session = ctx.remote!.pairing.createSession(urls);
    const host = primaryPairingHost(urls);
    return {
      qrUrl: ctx.remote!.pairing.buildQrUrl(host, session),
      hostPub: session.hostPub,
      pairSecret: session.pairSecret,
      urls: session.urls,
      expiresAt: session.expiresAt,
    };
  });
}

function registerE2EHooks(app: FastifyInstance, ctx: RemoteCoreContext): void {
  app.addHook("preValidation", async (request, reply) => {
    if (!ctx.remote || isLoopback(request.ip)) return;
    if (!request.device || request.device.deviceId === "local") return;
    if (request.headers["content-type"] !== E2E_CONTENT_TYPE) return;
    if (typeof request.body !== "string") return;

    try {
      const device = ctx.repos.devices.getById(request.device.deviceId);
      if (!device?.publicKey) return reply.code(401).send({ error: "unauthorized" });
      const framingKey = ctx.remote.framing.deriveKey(
        ctx.remote.hostKeys.privateKey,
        device.publicKey,
      );
      const session = await ctx.remote.framing.ensureSession(request.device.deviceId, framingKey);
      const decrypted = await session.decryptRequest(request.body);
      request.body = JSON.parse(decrypted.toString("utf8"));
      request.e2eActive = true;
    } catch {
      return reply.code(400).send({ error: "e2e_decrypt_failed" });
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (reply.statusCode >= 400 || !request.device) return payload;
    const device = ctx.repos.devices.getById(request.device.deviceId);
    if (!ctx.remote || !shouldUseE2E(request, device?.publicKey)) return payload;
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return payload;
    if (!device?.publicKey) return payload;

    try {
      const framingKey = ctx.remote.framing.deriveKey(
        ctx.remote.hostKeys.privateKey,
        device.publicKey,
      );
      const session = await ctx.remote.framing.ensureSession(request.device.deviceId, framingKey);
      const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      const encrypted = await session.encryptResponse(raw);
      reply.header("content-type", E2E_CONTENT_TYPE);
      return encrypted;
    } catch {
      return payload;
    }
  });
}

function mimeType(fileName: string): string {
  switch (extname(fileName)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".webmanifest":
      return "application/manifest+json";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

async function registerPwaStatic(app: FastifyInstance, pwaRoot: string): Promise<void> {
  const serveFile = (route: string, relativePath: string) => {
    app.get(route, async (_request, reply) => {
      const contents = await readFile(join(pwaRoot, relativePath));
      return reply.type(mimeType(relativePath)).send(contents);
    });
  };

  serveFile("/app", "index.html");
  serveFile("/app/", "index.html");
  serveFile("/app/index.html", "index.html");

  // Top-level PWA files (manifest, service worker, icons). Read per request so a
  // rebuilt UI is served without restarting the harness.
  for (const file of [
    "manifest.webmanifest",
    "sw.js",
    "favicon.png",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
  ]) {
    app.get(`/app/${file}`, async (_request, reply) => {
      try {
        const contents = await readFile(join(pwaRoot, file));
        return reply.type(mimeType(file)).send(contents);
      } catch {
        return reply.code(404).send({ error: "not_found" });
      }
    });
  }

  app.get("/app/assets/:file", async (request, reply) => {
    const { file } = request.params as { file: string };
    // Hashed bundle names only: no path separators or parent references.
    if (!/^[\w.-]+$/.test(file) || file.includes("..")) {
      return reply.code(404).send({ error: "not_found" });
    }
    try {
      const contents = await readFile(join(pwaRoot, "assets", file));
      return reply
        .header("cache-control", "public, max-age=31536000, immutable")
        .type(mimeType(file))
        .send(contents);
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
  });
}

export function shouldUseE2E(request: FastifyRequest, devicePublicKey?: string): boolean {
  return (
    !isLoopback(request.ip) &&
    request.device?.deviceId !== "local" &&
    Boolean(request.device && devicePublicKey)
  );
}
