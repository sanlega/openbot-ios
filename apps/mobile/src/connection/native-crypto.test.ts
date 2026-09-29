import { describe, expect, it, vi } from "vitest";

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digest: async () => new ArrayBuffer(32),
}));

vi.mock("react-native-libsodium", () => ({
  base64_variants: { ORIGINAL: 1, URLSAFE_NO_PADDING: 7 },
  crypto_box_keypair: () => ({
    privateKey: new Uint8Array(32).fill(1),
    publicKey: new Uint8Array(32).fill(2),
  }),
  crypto_scalarmult: () => new Uint8Array(32).fill(3),
  from_base64: (value: string, variant?: number) => {
    if (variant !== 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new Error("from_base64 failed");
    }
    return bytes(value);
  },
  to_base64: (value: Uint8Array, variant?: number) => {
    if (variant === 1) return base64(value);
    if (variant === 7)
      return base64(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    throw new Error("Base64 variant must be explicit");
  },
  randombytes_buf: (size: number) => new Uint8Array(size).fill(255),
}));

import {
  framingKeyFor,
  fromBase64,
  joinFrame,
  makeDeviceKeys,
  randomScopeId,
  toBase64,
  unpackFrame,
} from "./native-crypto";

describe("mobile Base64 wire format", () => {
  it("reads the host's padded SPKI and writes a standard Base64 device key", async () => {
    const prefix = new Uint8Array([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0,
    ]);
    const hostPublicKey = base64(new Uint8Array([...prefix, ...new Uint8Array(32).fill(4)]));

    await expect(framingKeyFor(hostPublicKey, new Uint8Array(32).fill(1))).resolves.toHaveLength(
      32,
    );
    expect((await makeDeviceKeys()).publicKeySpki).toBe(
      base64(new Uint8Array([...prefix, ...new Uint8Array(32).fill(2)])),
    );
    expect(fromBase64(toBase64(new Uint8Array([255, 254, 253])))).toEqual(
      new Uint8Array([255, 254, 253]),
    );
  });

  it("writes padded frames and generates URL-safe random scope IDs", () => {
    const header = new Uint8Array(24).fill(255);
    const ciphertext = new Uint8Array([254, 253]);
    const packed = joinFrame(header, ciphertext);
    expect(packed).toBe(base64(new Uint8Array([...header, ...ciphertext])));
    expect(unpackFrame(packed)).toEqual({ header, ciphertext });
    expect(randomScopeId()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
