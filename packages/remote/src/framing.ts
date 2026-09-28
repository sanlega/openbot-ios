import {
  computeSharedSecret,
  createPullStream,
  createPushStream,
  deriveFramingKey,
  E2E_CONTENT_TYPE,
  E2E_HEADER,
  packEncryptedFrame,
  unpackEncryptedFrame,
} from "./crypto.js";
import type { KeyObject } from "node:crypto";

export { E2E_CONTENT_TYPE, E2E_HEADER };

/** Server-side secretstream session for one paired device. */
export class DeviceE2ESession {
  private responsePushHeader: Uint8Array;
  private responsePush: Awaited<ReturnType<typeof createPushStream>>["push"];
  private responsePushStarted = false;
  private requestPull: Awaited<ReturnType<typeof createPullStream>> | undefined;
  private responsePull: Awaited<ReturnType<typeof createPullStream>> | undefined;

  private constructor(
    private readonly framingKey: Buffer,
    response: Awaited<ReturnType<typeof createPushStream>>,
  ) {
    this.responsePushHeader = response.header;
    this.responsePush = response.push;
  }

  static async create(framingKey: Buffer): Promise<DeviceE2ESession> {
    const response = await createPushStream(framingKey);
    return new DeviceE2ESession(framingKey, response);
  }

  getResponseHeaderBase64(): string {
    return Buffer.from(this.responsePushHeader).toString("base64");
  }

  async decryptRequest(encoded: string): Promise<Buffer> {
    let ciphertext: Uint8Array;
    if (!this.requestPull) {
      const frame = unpackEncryptedFrame(encoded);
      const { header } = frame;
      this.requestPull = await createPullStream(this.framingKey, header);
      ciphertext = frame.ciphertext;
    } else {
      ciphertext = new Uint8Array(Buffer.from(encoded, "base64"));
    }
    return Buffer.from(this.requestPull.decrypt(ciphertext));
  }

  async encryptResponse(plaintext: Buffer): Promise<string> {
    const ciphertext = this.responsePush.encrypt(new Uint8Array(plaintext));
    if (!this.responsePushStarted) {
      this.responsePushStarted = true;
      return packEncryptedFrame(this.responsePushHeader, ciphertext);
    }
    return Buffer.from(ciphertext).toString("base64");
  }

  async decryptWs(encoded: string): Promise<string> {
    return (await this.decryptRequest(encoded)).toString("utf8");
  }

  async encryptWs(plaintext: string): Promise<string> {
    return this.encryptResponse(Buffer.from(plaintext, "utf8"));
  }
}

/** Phone/client-side secretstream session (used in tests and PWA helpers). */
export class ClientE2ESession {
  private requestPushHeader: Uint8Array;
  private requestPush: Awaited<ReturnType<typeof createPushStream>>["push"];
  private requestPushStarted = false;
  private responsePullStarted = false;
  private requestPull: Awaited<ReturnType<typeof createPullStream>> | undefined;
  private responsePull: Awaited<ReturnType<typeof createPullStream>> | undefined;

  private constructor(
    private readonly framingKey: Buffer,
    request: Awaited<ReturnType<typeof createPushStream>>,
  ) {
    this.requestPushHeader = request.header;
    this.requestPush = request.push;
  }

  static async create(framingKey: Buffer, serverHeaderBase64?: string): Promise<ClientE2ESession> {
    const request = await createPushStream(framingKey);
    const session = new ClientE2ESession(framingKey, request);
    if (serverHeaderBase64) {
      session.responsePull = await createPullStream(
        framingKey,
        new Uint8Array(Buffer.from(serverHeaderBase64, "base64")),
      );
    }
    return session;
  }

  async encryptRequest(plaintext: Buffer): Promise<string> {
    const ciphertext = this.requestPush.encrypt(new Uint8Array(plaintext));
    if (!this.requestPushStarted) {
      this.requestPushStarted = true;
      return packEncryptedFrame(this.requestPushHeader, ciphertext);
    }
    return Buffer.from(ciphertext).toString("base64");
  }

  async decryptResponse(encoded: string): Promise<Buffer> {
    let ciphertext: Uint8Array;
    if (!this.responsePullStarted) {
      const frame = unpackEncryptedFrame(encoded);
      this.responsePull ??= await createPullStream(this.framingKey, frame.header);
      ciphertext = frame.ciphertext;
      this.responsePullStarted = true;
    } else {
      ciphertext = new Uint8Array(Buffer.from(encoded, "base64"));
    }
    return Buffer.from(this.responsePull!.decrypt(ciphertext));
  }
}

export class E2EFraming {
  private readonly sessions = new Map<string, DeviceE2ESession>();
  private readonly keys = new Map<string, Buffer>();

  rememberFramingKey(deviceId: string, key: Buffer, scopeId = "default"): void {
    this.keys.set(this.sessionKey(deviceId, scopeId), key);
  }

  deriveKey(hostPrivateKey: KeyObject, devicePublicKeyBase64: string): Buffer {
    return deriveFramingKey(computeSharedSecret(hostPrivateKey, devicePublicKeyBase64));
  }

  async ensureSession(
    deviceId: string,
    framingKey?: Buffer,
    scopeId = "default",
  ): Promise<DeviceE2ESession> {
    const sessionKey = this.sessionKey(deviceId, scopeId);
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing;
    const key = framingKey ?? this.keys.get(sessionKey);
    if (!key) throw new Error(`no framing key for device ${deviceId}`);
    const session = await DeviceE2ESession.create(key);
    this.sessions.set(sessionKey, session);
    this.keys.set(sessionKey, key);
    return session;
  }

  hasSession(deviceId: string, scopeId = "default"): boolean {
    return this.sessions.has(this.sessionKey(deviceId, scopeId));
  }

  clearSession(deviceId: string, scopeId?: string): void {
    if (scopeId !== undefined) {
      const key = this.sessionKey(deviceId, scopeId);
      this.sessions.delete(key);
      this.keys.delete(key);
      return;
    }
    for (const key of this.sessions.keys()) {
      if (key.startsWith(`${deviceId}:`)) this.sessions.delete(key);
    }
    for (const key of this.keys.keys()) {
      if (key.startsWith(`${deviceId}:`)) this.keys.delete(key);
    }
  }

  getSession(deviceId: string, scopeId = "default"): DeviceE2ESession | undefined {
    return this.sessions.get(this.sessionKey(deviceId, scopeId));
  }

  private sessionKey(deviceId: string, scopeId: string): string {
    return `${deviceId}:${scopeId}`;
  }
}
