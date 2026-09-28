import type { FastifyReply, FastifyRequest } from "fastify";
import type { DeviceIdentity } from "../device-auth.js";
import type { CoreContext } from "../context.js";
import { openSecret } from "@openbot/remote";

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

const proofNonces = new Map<string, number>();
const PROOF_WINDOW_MS = 5 * 60_000;

/** Resolves an E2E-sealed bearer token without putting it in a clear HTTP header. */
export async function resolveSealedDeviceIdentity(
  ctx: CoreContext,
  request: FastifyRequest,
): Promise<DeviceIdentity | undefined> {
  const rawId = request.headers["x-openbot-device"];
  const rawProof = request.headers["x-openbot-device-token"];
  const deviceId = Array.isArray(rawId) ? rawId[0] : rawId;
  const sealed = Array.isArray(rawProof) ? rawProof[0] : rawProof;
  if (!deviceId || !sealed || !ctx.remote) return undefined;

  const device = ctx.repos.devices.getById(deviceId);
  if (!device?.publicKey || device.revokedAt) return undefined;

  try {
    const key = ctx.remote.framing.deriveKey(ctx.remote.hostKeys.privateKey, device.publicKey);
    const proof = JSON.parse((await openSecret(key, sealed)).toString("utf8")) as {
      token?: unknown;
      nonce?: unknown;
      issuedAt?: unknown;
    };
    if (
      typeof proof.token !== "string" ||
      typeof proof.nonce !== "string" ||
      typeof proof.issuedAt !== "number" ||
      Math.abs(Date.now() - proof.issuedAt) > PROOF_WINDOW_MS
    ) {
      return undefined;
    }

    const replayKey = `${deviceId}:${proof.nonce}`;
    pruneProofNonces(Date.now());
    if (proofNonces.has(replayKey)) return undefined;
    const identity = ctx.deviceAuth.verifyToken(proof.token);
    if (!identity || identity.deviceId !== deviceId) return undefined;
    proofNonces.set(replayKey, proof.issuedAt + PROOF_WINDOW_MS);
    return identity;
  } catch {
    return undefined;
  }
}

function pruneProofNonces(now: number): void {
  for (const [key, expiry] of proofNonces) {
    if (expiry < now) proofNonces.delete(key);
  }
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
