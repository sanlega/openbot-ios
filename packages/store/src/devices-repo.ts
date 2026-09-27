import type { Device } from "@openbot/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "./db.js";
import { devices } from "./schema.js";

type DeviceRow = typeof devices.$inferSelect;

/** Paired devices and their role (plan §4.1/§4.7: only `owner` devices can change settings/caps/rules/devices/vault/remote). */
export class DevicesRepo {
  constructor(private readonly db: Db) {}

  create(device: Device): void {
    this.db
      .insert(devices)
      .values({
        id: device.id,
        name: device.name,
        role: device.role,
        publicKey: device.publicKey,
        via: device.via,
        pairedAt: new Date(device.pairedAt),
        lastSeenAt: device.lastSeenAt ? new Date(device.lastSeenAt) : undefined,
        revokedAt: device.revokedAt ? new Date(device.revokedAt) : undefined,
      })
      .run();
  }

  getById(id: string): Device | undefined {
    const row = this.db.select().from(devices).where(eq(devices.id, id)).get();
    return row ? toDevice(row) : undefined;
  }

  list(): Device[] {
    return this.db.select().from(devices).all().map(toDevice);
  }

  touchLastSeen(id: string, at: Date): void {
    this.db.update(devices).set({ lastSeenAt: at }).where(eq(devices.id, id)).run();
  }

  revoke(id: string, at: Date): void {
    this.db.update(devices).set({ revokedAt: at }).where(eq(devices.id, id)).run();
  }
}

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    role: row.role as Device["role"],
    publicKey: row.publicKey,
    via: row.via as Device["via"],
    pairedAt: row.pairedAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString(),
    revokedAt: row.revokedAt?.toISOString(),
  };
}
