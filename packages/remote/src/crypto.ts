import {
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import _sodium from "libsodium-wrappers";

export const E2E_CONTENT_TYPE = "application/x-openbot-e2e";
export const E2E_HEADER = "x-openbot-e2e";

export interface X25519KeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
  publicKeyBase64: string;
}

let sodiumReady: Promise<void> | undefined;

export async function ensureSodium(): Promise<typeof _sodium> {
  if (!sodiumReady) sodiumReady = _sodium.ready;
  await sodiumReady;
  return _sodium;
}

/** Generates an X25519 keypair; public key is stored/transmitted as base64 SPKI. */
export function generateX25519KeyPair(): X25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey,
    privateKey,
    publicKeyBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

export function importX25519PublicKey(publicKeyBase64: string): KeyObject {
  return createPublicKeyFromSpki(publicKeyBase64);
}

function createPublicKeyFromSpki(publicKeyBase64: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(publicKeyBase64, "base64"),
    format: "der",
    type: "spki",
  });
}

/** ECDH shared secret between host private key and a device public key (SPKI base64). */
export function computeSharedSecret(
  hostPrivateKey: KeyObject,
  devicePublicKeyBase64: string,
): Buffer {
  return diffieHellman({
    privateKey: hostPrivateKey,
    publicKey: importX25519PublicKey(devicePublicKeyBase64),
  });
}

/** Derives a 32-byte `secretstream` key from the X25519 shared secret. */
export function deriveFramingKey(sharedSecret: Buffer): Buffer {
  return createHash("sha256").update(Buffer.from("openbot-e2e-v1")).update(sharedSecret).digest();
}

export function randomPairSecret(): string {
  return randomBytes(32).toString("base64url");
}

export interface SecretstreamPush {
  encrypt(plaintext: Uint8Array): Uint8Array;
  finalize(): Uint8Array;
}

export interface SecretstreamPull {
  decrypt(ciphertext: Uint8Array): Uint8Array;
}

/** Creates a push-side secretstream session; the 24-byte header must travel with the first frame. */
export async function createPushStream(
  framingKey: Buffer,
): Promise<{ header: Uint8Array; push: SecretstreamPush }> {
  const sodium = await ensureSodium();
  const key = new Uint8Array(framingKey);
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
  return {
    header: new Uint8Array(header),
    push: {
      encrypt(plaintext: Uint8Array): Uint8Array {
        return sodium.crypto_secretstream_xchacha20poly1305_push(
          state,
          plaintext,
          null,
          sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
        );
      },
      finalize(): Uint8Array {
        return sodium.crypto_secretstream_xchacha20poly1305_push(
          state,
          new Uint8Array(0),
          null,
          sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
        );
      },
    },
  };
}

/** Creates a pull-side secretstream session from the peer header. */
export async function createPullStream(
  framingKey: Buffer,
  header: Uint8Array,
): Promise<SecretstreamPull> {
  const sodium = await ensureSodium();
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
    new Uint8Array(header),
    new Uint8Array(framingKey),
  );
  return {
    decrypt(ciphertext: Uint8Array): Uint8Array {
      const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, ciphertext, null);
      return result.message;
    },
  };
}

/** Concatenates header + ciphertext and base64-encodes for wire transport. */
export function packEncryptedFrame(header: Uint8Array, ciphertext: Uint8Array): string {
  const packed = Buffer.concat([Buffer.from(header), Buffer.from(ciphertext)]);
  return packed.toString("base64");
}

export function unpackEncryptedFrame(encoded: string): {
  header: Uint8Array;
  ciphertext: Uint8Array;
} {
  const packed = Buffer.from(encoded, "base64");
  if (packed.length < 25) throw new Error("encrypted frame too short");
  return {
    header: new Uint8Array(packed.subarray(0, 24)),
    ciphertext: new Uint8Array(packed.subarray(24)),
  };
}

/** Seals a small credential or pairing payload with the existing device framing key. */
export async function sealSecret(key: Uint8Array, plaintext: Uint8Array): Promise<string> {
  const sodium = await ensureSodium();
  const nonce = randomBytes(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(
    new Uint8Array(plaintext),
    nonce,
    new Uint8Array(key),
  );
  return Buffer.concat([nonce, Buffer.from(ciphertext)]).toString("base64");
}

/** Opens a value produced by `sealSecret`; authentication failure throws. */
export async function openSecret(key: Uint8Array, sealed: string): Promise<Buffer> {
  const sodium = await ensureSodium();
  const packed = Buffer.from(sealed, "base64");
  const nonceBytes = sodium.crypto_secretbox_NONCEBYTES;
  if (packed.length < nonceBytes + sodium.crypto_secretbox_MACBYTES) {
    throw new Error("sealed value too short");
  }
  const plaintext = sodium.crypto_secretbox_open_easy(
    new Uint8Array(packed.subarray(nonceBytes)),
    new Uint8Array(packed.subarray(0, nonceBytes)),
    new Uint8Array(key),
  );
  return Buffer.from(plaintext);
}
