import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { newId } from "@openbot/contracts";
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
  config: { port: number };
  vault: { get(key: string): Promise<string | undefined>; set(key: string, value: string): Promise<void> };
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
  eventBus: { publish(input: { type: string; payload: Record<string, unknown> }): Promise<unknown> };
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

  app.post("/api/devices/pair/qr", async (request, reply) => {
    if (!requireOwnerDevice(request, reply)) return;
    const ts = await ctx.remote!.tailscale.status();
    const cf = ctx.remote!.cloudflare.status();
    const urls = collectPairingUrls({
      port: ctx.config.port,
      tailscaleUrls: ts.serveUrls,
      cloudflareHostname: cf.hostname,
    });
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

  for (const optional of ["manifest.webmanifest", "sw.js"]) {
    try {
      await readFile(join(pwaRoot, optional));
      serveFile(`/app/${optional}`, optional);
    } catch {
      // Built UI may omit legacy PWA assets.
    }
  }

  try {
    const assets = await readdir(join(pwaRoot, "assets"));
    for (const asset of assets) {
      serveFile(`/app/assets/${asset}`, join("assets", asset));
    }
  } catch {
    // No hashed assets yet — build step may not have run.
  }
}

export function shouldUseE2E(request: FastifyRequest, devicePublicKey?: string): boolean {
  return (
    !isLoopback(request.ip) &&
    request.device?.deviceId !== "local" &&
    Boolean(request.device && devicePublicKey)
  );
}
