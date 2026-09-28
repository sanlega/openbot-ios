import * as Crypto from "expo-crypto";
import * as sodium from "react-native-libsodium";

const X25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00,
]);
const utf8 = new TextEncoder();

export interface MobileDeviceKeys {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeySpki: string;
}

export interface PushStream {
  header: Uint8Array;
  push: (value: Uint8Array) => Uint8Array;
}

export interface PullStream {
  pull: (value: Uint8Array) => Uint8Array;
}

export async function makeDeviceKeys(privateKey?: Uint8Array): Promise<MobileDeviceKeys> {
  const keyPair = privateKey
    ? { privateKey, publicKey: sodium.crypto_scalarmult_base(privateKey) }
    : sodium.crypto_box_keypair();
  const publicKeySpki = sodium.to_base64(concat(X25519_SPKI_PREFIX, keyPair.publicKey));
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeySpki,
  };
}

export async function framingKeyFor(hostPubSpki: string, devicePrivateKey: Uint8Array) {
  const hostSpki = sodium.from_base64(hostPubSpki);
  if (!hasPrefix(hostSpki, X25519_SPKI_PREFIX) || hostSpki.length !== 44) {
    throw new Error("The pairing QR contains an invalid OpenBot host key.");
  }
  const shared = sodium.crypto_scalarmult(devicePrivateKey, hostSpki.slice(-32));
  const domain = utf8.encode("openbot-e2e-v1");
  return new Uint8Array(
    await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, toArrayBuffer(concat(domain, shared))),
  );
}

export function seal(key: Uint8Array, clear: Uint8Array): string {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(clear, nonce, key);
  return sodium.to_base64(concat(nonce, ciphertext));
}

export function open(key: Uint8Array, sealed: string): Uint8Array {
  const packed = sodium.from_base64(sealed);
  const nonceBytes = sodium.crypto_secretbox_NONCEBYTES;
  if (packed.length < nonceBytes + 16)
    throw new Error("The encrypted OpenBot response is incomplete.");
  return sodium.crypto_secretbox_open_easy(
    packed.slice(nonceBytes),
    packed.slice(0, nonceBytes),
    key,
  );
}

export function authProof(key: Uint8Array, token: string): string {
  const proof = {
    token,
    nonce: sodium.to_base64(sodium.randombytes_buf(24), sodium.base64_variants.URLSAFE_NO_PADDING),
    issuedAt: Date.now(),
  };
  return seal(key, utf8.encode(JSON.stringify(proof)));
}

export function encodeText(value: string): Uint8Array {
  return utf8.encode(value);
}

export function decodeText(value: Uint8Array): string {
  return sodium.to_string(value);
}

export function toBase64(value: Uint8Array): string {
  return sodium.to_base64(value);
}

export function fromBase64(value: string): Uint8Array {
  return sodium.from_base64(value);
}

export function createPushStream(key: Uint8Array): PushStream {
  const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
  return {
    header,
    push: (value) =>
      sodium.crypto_secretstream_xchacha20poly1305_push(
        state,
        value,
        null,
        sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
      ),
  };
}

export function createPullStream(key: Uint8Array, header: Uint8Array): PullStream {
  const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key);
  return {
    pull: (value) => {
      const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, value, null);
      if (result === false) throw new Error("The encrypted OpenBot frame failed authentication.");
      return result.message;
    },
  };
}

export function joinFrame(header: Uint8Array, ciphertext: Uint8Array): string {
  return sodium.to_base64(concat(header, ciphertext));
}

export function unpackFrame(encoded: string): { header: Uint8Array; ciphertext: Uint8Array } {
  const bytes = sodium.from_base64(encoded);
  if (bytes.length < 25) throw new Error("Encrypted frame is too short.");
  return { header: bytes.slice(0, 24), ciphertext: bytes.slice(24) };
}

export function concat(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.length);
  new Uint8Array(result).set(bytes);
  return result;
}

function hasPrefix(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => value[index] === byte);
}
