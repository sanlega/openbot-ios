import { readFileSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApnsEnvironment } from "./apns.js";

/** Non-secret APNs settings; the `.p8` key itself lives in the vault. */
export interface PushConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  /** Include message text in notifications (it passes through Apple). */
  previews: boolean;
}

export interface PushDevice {
  token: string;
  /** Learned from APNs: which gateway accepts this token. */
  environment?: ApnsEnvironment;
  updatedAt: string;
}

interface PushFile {
  config?: PushConfig;
  devices: Record<string, PushDevice>;
}

export const APNS_KEY_VAULT_KEY = "apns.authKey";
export const DEFAULT_BUNDLE_ID = "ai.openbot.mobile";
const FILE = "push.json";

/** Push settings and per-device APNs tokens under `OPENBOT_HOME` (no schema change needed). */
export class PushStore {
  private data: PushFile;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly openbotHome: string) {
    this.data = read(openbotHome);
  }

  config(): PushConfig | undefined {
    return this.data.config;
  }

  async setConfig(config: PushConfig): Promise<void> {
    this.data = { ...this.data, config };
    await this.save();
  }

  devices(): Array<[string, PushDevice]> {
    return Object.entries(this.data.devices);
  }

  device(deviceId: string): PushDevice | undefined {
    return this.data.devices[deviceId];
  }

  async register(deviceId: string, token: string, at: Date): Promise<void> {
    const previous = this.data.devices[deviceId];
    this.data.devices[deviceId] = {
      token,
      environment: previous?.token === token ? previous.environment : undefined,
      updatedAt: at.toISOString(),
    };
    await this.save();
  }

  async setEnvironment(deviceId: string, environment: ApnsEnvironment): Promise<void> {
    const device = this.data.devices[deviceId];
    if (!device || device.environment === environment) return;
    device.environment = environment;
    await this.save();
  }

  async remove(deviceId: string): Promise<void> {
    if (!(deviceId in this.data.devices)) return;
    delete this.data.devices[deviceId];
    await this.save();
  }

  /** Serialized, atomic writes readable only by this user (tokens identify the phone). */
  private save(): Promise<void> {
    const snapshot = `${JSON.stringify(this.data, null, 2)}\n`;
    this.writing = this.writing.then(async () => {
      await mkdir(this.openbotHome, { recursive: true });
      const target = join(this.openbotHome, FILE);
      const temp = `${target}.tmp`;
      await writeFile(temp, snapshot, { mode: 0o600 });
      await chmod(temp, 0o600).catch(() => undefined);
      await rename(temp, target);
    });
    return this.writing;
  }
}

function read(openbotHome: string): PushFile {
  try {
    const parsed = JSON.parse(readFileSync(join(openbotHome, FILE), "utf8")) as Partial<PushFile>;
    return { config: parsed.config, devices: parsed.devices ?? {} };
  } catch {
    return { devices: {} };
  }
}
