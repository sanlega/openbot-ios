import type { FastifyInstance } from "fastify";
import { newId } from "@openbot/contracts";
import type { CoreContext } from "../../context.js";
import { requireOwner } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { PairDeviceBody } from "../schemas.js";

/**
 * Device pairing, listing, and revocation (plan §4.7 "Devices"). The real QR
 * payload/X25519 handshake/`secretstream` framing is WS11's job (plan §4.8);
 * this issues a bearer token the moment a `Device` row exists, so WS11 can
 * layer E2E crypto on top of an already-working token/role system.
 */
export function registerDeviceRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.post("/api/devices/pair", async (request, reply) => {
    const body = parseOrReject(PairDeviceBody, request.body, reply);
    if (!body) return;

    const existingDevices = ctx.repos.devices.list();
    const requestedRole = body.role;
    // Bootstraps the very first device as `owner`; after that, only an
    // already-authenticated owner may mint another owner device.
    let role: "owner" | "approver";
    if (existingDevices.length === 0) {
      role = requestedRole ?? "owner";
    } else if (requestedRole === "owner") {
      if (!requireOwner(request, reply)) return;
      role = "owner";
    } else {
      role = requestedRole ?? "approver";
    }

    const device = {
      id: newId("device"),
      name: body.name,
      role,
      publicKey: "",
      via: body.via,
      pairedAt: ctx.clock.now().toISOString(),
    };
    ctx.repos.devices.create(device);
    const token = ctx.deviceAuth.issueToken(device.id);
    await ctx.eventBus.publish({ type: "device.paired", payload: { deviceId: device.id, role } });
    reply.code(201);
    return { device, token };
  });

  app.get("/api/devices", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    return { devices: ctx.repos.devices.list() };
  });

  app.delete("/api/devices/:id", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!ctx.repos.devices.getById(id)) return reply.code(404).send({ error: "not_found" });
    ctx.repos.devices.revoke(id, ctx.clock.now());
    await ctx.eventBus.publish({ type: "device.revoked", payload: { deviceId: id } });
    return { ok: true };
  });
}
