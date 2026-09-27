import type { FastifyReply, FastifyRequest } from "fastify";
import type { DeviceIdentity } from "../device-auth.js";
import type { CoreContext } from "../context.js";

declare module "fastify" {
  interface FastifyRequest {
    device?: DeviceIdentity;
  }
}

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopback(ip: string): boolean {
  return LOOPBACK_ADDRESSES.has(ip);
}

function isLoopbackIp(ip: string): boolean {
  return isLoopback(ip);
}

/**
 * Resolves `request.device` before any route handler runs. A bearer token is
 * always verified if present (`Authorization: Bearer <token>`); with no
 * token, a request arriving over loopback is implicitly the local owner —
 * matching "the harness binds to loopback by default" (plan §4.8): the local
 * desktop/CLI never needs to pair a device with itself. A non-loopback
 * request with no valid token is rejected — this is what lets the harness
 * safely bind beyond loopback once remote access + device auth are on.
 */
export function resolveDeviceIdentity(
  ctx: CoreContext,
  request: FastifyRequest,
): DeviceIdentity | undefined {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return ctx.deviceAuth.verifyToken(authHeader.slice("Bearer ".length));
  }
  if (isLoopback(request.ip)) {
    return { deviceId: "local", role: "owner" };
  }
  return undefined;
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.device) {
    reply
      .code(401)
      .send({ error: "unauthorized", reason: "missing or invalid device credentials" });
    return false;
  }
  return true;
}

/** Owner-only guard (plan §4.7: "Only `owner` devices can change settings, caps, rules, devices, the vault, or remote setup."). */
export function requireOwner(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!requireAuth(request, reply)) return false;
  if (request.device?.role !== "owner") {
    reply.code(403).send({ error: "forbidden", reason: "owner device required" });
    return false;
  }
  return true;
}

/** OAuth browser callbacks must arrive on loopback only — never expose off-host. */
export function requireLoopback(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!isLoopbackIp(request.ip)) {
    reply.code(403).send({ error: "forbidden", reason: "oauth callback requires loopback" });
    return false;
  }
  return true;
}
