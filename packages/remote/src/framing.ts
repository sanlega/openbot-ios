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
    const { header, ciphertext } = unpackEncryptedFrame(encoded);
    if (header.length === 24) {
      this.requestPull = await createPullStream(this.framingKey, header);
    }
    if (!this.requestPull) throw new Error("missing client E2E header");
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
  private requestPull: Awaited<ReturnType<typeof createPullStream>> | undefined;
  private responsePull: Awaited<ReturnType<typeof createPullStream>> | undefined;

  private constructor(
    private readonly framingKey: Buffer,
    request: Awaited<ReturnType<typeof createPushStream>>,
  ) {
    this.requestPushHeader = request.header;
    this.requestPush = request.push;
  }

  static async create(framingKey: Buffer, serverHeaderBase64: string): Promise<ClientE2ESession> {
    const request = await createPushStream(framingKey);
    const session = new ClientE2ESession(framingKey, request);
    session.responsePull = await createPullStream(
      framingKey,
      new Uint8Array(Buffer.from(serverHeaderBase64, "base64")),
    );
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
    const { header, ciphertext } = unpackEncryptedFrame(encoded);
    if (header.length === 24) {
      this.responsePull = await createPullStream(this.framingKey, header);
    }
    if (!this.responsePull) throw new Error("missing server E2E header");
    return Buffer.from(this.responsePull.decrypt(ciphertext));
  }
}

export class E2EFraming {
  private readonly sessions = new Map<string, DeviceE2ESession>();
  private readonly keys = new Map<string, Buffer>();

  rememberFramingKey(deviceId: string, key: Buffer): void {
    this.keys.set(deviceId, key);
  }

  deriveKey(hostPrivateKey: KeyObject, devicePublicKeyBase64: string): Buffer {
    return deriveFramingKey(computeSharedSecret(hostPrivateKey, devicePublicKeyBase64));
  }

  async ensureSession(deviceId: string, framingKey?: Buffer): Promise<DeviceE2ESession> {
    const existing = this.sessions.get(deviceId);
    if (existing) return existing;
    const key = framingKey ?? this.keys.get(deviceId);
    if (!key) throw new Error(`no framing key for device ${deviceId}`);
    const session = await DeviceE2ESession.create(key);
    this.sessions.set(deviceId, session);
    this.keys.set(deviceId, key);
    return session;
  }

  hasSession(deviceId: string): boolean {
    return this.sessions.has(deviceId);
  }

  clearSession(deviceId: string): void {
    this.sessions.delete(deviceId);
    this.keys.delete(deviceId);
  }

  getSession(deviceId: string): DeviceE2ESession | undefined {
    return this.sessions.get(deviceId);
  }
}
