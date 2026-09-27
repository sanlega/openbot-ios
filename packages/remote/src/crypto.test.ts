import { describe, expect, it } from "vitest";
import {
  computeSharedSecret,
  deriveFramingKey,
  generateX25519KeyPair,
  packEncryptedFrame,
  unpackEncryptedFrame,
} from "./crypto.js";
import { ClientE2ESession, DeviceE2ESession } from "./framing.js";

describe("X25519 + secretstream vectors", () => {
  it("derives the same framing key on both sides", () => {
    const host = generateX25519KeyPair();
    const device = generateX25519KeyPair();
    const hostShared = computeSharedSecret(host.privateKey, device.publicKeyBase64);
    const deviceShared = computeSharedSecret(device.privateKey, host.publicKeyBase64);
    expect(deriveFramingKey(hostShared)).toEqual(deriveFramingKey(deviceShared));
  });

  it("round-trips encrypted HTTP payloads", async () => {
    const host = generateX25519KeyPair();
    const device = generateX25519KeyPair();
    const framingKey = deriveFramingKey(
      computeSharedSecret(host.privateKey, device.publicKeyBase64),
    );

    const server = await DeviceE2ESession.create(framingKey);
    const client = await ClientE2ESession.create(framingKey, server.getResponseHeaderBase64());

    const request = Buffer.from(JSON.stringify({ hello: "phone" }));
    const encryptedReq = await client.encryptRequest(request);
    const decryptedReq = await server.decryptRequest(encryptedReq);
    expect(decryptedReq.toString("utf8")).toBe(request.toString("utf8"));

    const response = Buffer.from(JSON.stringify({ ok: true }));
    const encryptedRes = await server.encryptResponse(response);
    const decryptedRes = await client.decryptResponse(encryptedRes);
    expect(decryptedRes.toString("utf8")).toBe(response.toString("utf8"));
  });

  it("rejects tampered ciphertext", async () => {
    const host = generateX25519KeyPair();
    const device = generateX25519KeyPair();
    const framingKey = deriveFramingKey(
      computeSharedSecret(host.privateKey, device.publicKeyBase64),
    );
    const server = await DeviceE2ESession.create(framingKey);
    const client = await ClientE2ESession.create(framingKey, server.getResponseHeaderBase64());
    const encrypted = await client.encryptRequest(Buffer.from("secret"));
    const { header, ciphertext } = unpackEncryptedFrame(encrypted);
    if (ciphertext.length > 0) ciphertext[0]! ^= 0xff;
    const tampered = packEncryptedFrame(header, ciphertext);
    await expect(server.decryptRequest(tampered)).rejects.toThrow();
  });
});
