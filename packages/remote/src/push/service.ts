import { ApnsSender, parseApnsKey, type ApnsEnvironment, type ApnsTransport } from "./apns.js";
import { pushContentFor, type PushContent, type PushEvent, type PushLookups } from "./content.js";
import type { PushStore } from "./store.js";
import { APNS_KEY_VAULT_KEY, DEFAULT_BUNDLE_ID, type PushConfig } from "./store.js";

export interface PushServiceOptions {
  store: PushStore;
  vault: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
  };
  lookups: PushLookups;
  /** False for unknown or revoked devices, whose tokens are then dropped. */
  isActiveDevice(deviceId: string): boolean;
  clock: { now(): Date };
  transport?: ApnsTransport;
  log?: (message: string) => void;
}

export interface PushStatus {
  configured: boolean;
  keyId?: string;
  teamId?: string;
  bundleId: string;
  previews: boolean;
  devices: number;
}

export interface PushConfigInput {
  keyP8?: string;
  keyId: string;
  teamId: string;
  bundleId?: string;
  previews?: boolean;
}

/** Sends APNs notifications straight from this computer with the owner's own key. */
export class PushService {
  private sender: ApnsSender | undefined;
  private senderLoaded = false;

  constructor(private readonly options: PushServiceOptions) {}

  async status(): Promise<PushStatus> {
    const config = this.options.store.config();
    const hasKey = !!(await this.options.vault.get(APNS_KEY_VAULT_KEY));
    return {
      configured: !!config && hasKey,
      keyId: config?.keyId,
      teamId: config?.teamId,
      bundleId: config?.bundleId ?? DEFAULT_BUNDLE_ID,
      previews: config?.previews ?? true,
      devices: this.options.store.devices().length,
    };
  }

  /** Validates and saves the APNs key and IDs; the key text goes only to the vault. */
  async configure(input: PushConfigInput): Promise<PushStatus> {
    const keyId = input.keyId.trim();
    const teamId = input.teamId.trim();
    if (!/^[A-Z0-9]{10}$/.test(keyId))
      throw new Error("The Key ID is the 10-character ID shown next to the key.");
    if (!/^[A-Z0-9]{10}$/.test(teamId))
      throw new Error("The Team ID is the 10-character ID of your developer team.");
    const bundleId = (input.bundleId ?? DEFAULT_BUNDLE_ID).trim() || DEFAULT_BUNDLE_ID;
    if (input.keyP8) {
      parseApnsKey(input.keyP8);
      await this.options.vault.set(APNS_KEY_VAULT_KEY, input.keyP8.trim());
    } else if (!(await this.options.vault.get(APNS_KEY_VAULT_KEY))) {
      throw new Error("Add your .p8 key.");
    }
    const config: PushConfig = {
      keyId,
      teamId,
      bundleId,
      previews: input.previews ?? this.options.store.config()?.previews ?? true,
    };
    await this.options.store.setConfig(config);
    this.sender = undefined;
    this.senderLoaded = false;
    return this.status();
  }

  async register(deviceId: string, token: string): Promise<void> {
    if (!/^[0-9a-fA-F]{32,200}$/.test(token)) throw new Error("invalid_token");
    await this.options.store.register(deviceId, token.toLowerCase(), this.options.clock.now());
  }

  unregister(deviceId: string): Promise<void> {
    return this.options.store.remove(deviceId);
  }

  isRegistered(deviceId: string): boolean {
    return !!this.options.store.device(deviceId);
  }

  /** Called for every event on the bus; sends only for push-worthy ones. */
  async handle(event: PushEvent): Promise<void> {
    const previews = this.options.store.config()?.previews ?? true;
    const content = pushContentFor(event, this.options.lookups, { previews });
    if (!content || !this.options.store.devices().length) return;
    await this.deliver(content);
  }

  /** Sends a test notification; returns how many phones accepted it. */
  async sendTest(): Promise<{ sent: number; failed: number; reasons: string[] }> {
    const result = await this.deliver({
      title: "OpenBot",
      body: "Notifications from your desktop are working.",
      data: { kind: "update" },
    });
    if (!result) throw new Error("Set up your APNs key first.");
    return result;
  }

  private async deliver(
    content: PushContent,
  ): Promise<{ sent: number; failed: number; reasons: string[] } | undefined> {
    const sender = await this.loadSender();
    if (!sender) return undefined;
    let sent = 0;
    const reasons: string[] = [];
    for (const [deviceId, device] of this.options.store.devices()) {
      if (!this.options.isActiveDevice(deviceId)) {
        await this.options.store.remove(deviceId);
        continue;
      }
      const notification = {
        title: content.title,
        body: content.body,
        threadId: content.threadId,
        collapseId: content.collapseId,
        data: content.data,
      };
      const tryOn = (environment: ApnsEnvironment) =>
        sender.send(device.token, notification, environment).catch((error: unknown) => ({
          ok: false,
          status: 0,
          reason: error instanceof Error ? error.message : "network error",
        }));
      const first: ApnsEnvironment = device.environment ?? "production";
      let result = await tryOn(first);
      // Development-signed builds get sandbox tokens; learn which gateway takes this one.
      if (!result.ok && result.reason === "BadDeviceToken" && !device.environment) {
        result = await tryOn("sandbox");
        if (result.ok) await this.options.store.setEnvironment(deviceId, "sandbox");
      } else if (result.ok && !device.environment) {
        await this.options.store.setEnvironment(deviceId, first);
      }
      if (result.ok) {
        sent += 1;
        continue;
      }
      const reason = result.reason ?? `HTTP ${result.status}`;
      reasons.push(reason);
      if (result.reason === "Unregistered" || result.reason === "BadDeviceToken") {
        await this.options.store.remove(deviceId);
      }
      this.options.log?.(`push to a paired phone failed: ${reason}`);
    }
    return { sent, failed: reasons.length, reasons };
  }

  private async loadSender(): Promise<ApnsSender | undefined> {
    if (this.senderLoaded) return this.sender;
    this.senderLoaded = true;
    const config = this.options.store.config();
    const key = await this.options.vault.get(APNS_KEY_VAULT_KEY);
    if (!config || !key) return undefined;
    try {
      this.sender = new ApnsSender(
        { keyP8: key, keyId: config.keyId, teamId: config.teamId, bundleId: config.bundleId },
        this.options.transport,
      );
    } catch (error) {
      this.options.log?.(`APNs key unusable: ${error instanceof Error ? error.message : "error"}`);
      this.sender = undefined;
    }
    return this.sender;
  }
}
