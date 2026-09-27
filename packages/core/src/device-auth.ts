import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DeviceRole } from "@openbot/contracts";
import type { DevicesRepo } from "@openbot/store";

/**
 * Device tokens and role enforcement (plan §5 WS1: "device tokens and roles").
 * Full pairing crypto (QR payload, X25519 handshake, `secretstream` framing) is
 * WS11's job (plan §4.8) — this issues a bearer token once a `Device` row
 * exists (however it was created) and verifies it on every request, so WS11
 * can layer E2E framing on top without WS1 needing to change.
 *
 * The token is a signed, stateless claim (HMAC-SHA256 over `deviceId`), not a
 * database lookup, so verifying it is O(1) and needs no extra table/migration.
 * Revocation is still authoritative: every verify re-checks `Device.revokedAt`.
 */
export interface DeviceIdentity {
  deviceId: string;
  role: DeviceRole;
}

const TOKEN_SEPARATOR = ".";

export class DeviceAuth {
  constructor(
    private readonly devices: DevicesRepo,
    private readonly secret: Buffer,
  ) {}

  /** Issues a bearer token for an already-paired device (its `Device` row must exist). */
  issueToken(deviceId: string): string {
    const signature = this.sign(deviceId);
    return `${deviceId}${TOKEN_SEPARATOR}${signature}`;
  }

  /** Verifies signature, then re-checks the device exists and isn't revoked. Returns `undefined` if either fails. */
  verifyToken(token: string): DeviceIdentity | undefined {
    const separatorIndex = token.indexOf(TOKEN_SEPARATOR);
    if (separatorIndex < 0) return undefined;
    const deviceId = token.slice(0, separatorIndex);
    const signature = token.slice(separatorIndex + 1);
    if (!this.safeEquals(signature, this.sign(deviceId))) return undefined;

    const device = this.devices.getById(deviceId);
    if (!device || device.revokedAt) return undefined;
    return { deviceId: device.id, role: device.role };
  }

  private sign(deviceId: string): string {
    return createHmac("sha256", this.secret).update(deviceId).digest("hex");
  }

  private safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}

/** Generates a fresh 32-byte device-token signing secret (persisted by the caller, e.g. in the vault). */
export function generateDeviceSecret(): Buffer {
  return randomBytes(32);
}

/** Owner-only routes (plan §4.7: "Only `owner` devices can change settings, caps, rules, devices, the vault, or remote setup."). */
export function requireOwner(identity: DeviceIdentity | undefined): identity is DeviceIdentity {
  return identity?.role === "owner";
}
