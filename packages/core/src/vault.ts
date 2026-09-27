import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Secrets storage (plan E4): "Electron `safeStorage` (Keychain, DPAPI, or
 * libsecret), or a 0600 file when headless." `packages/core` (headless/server)
 * only needs the file-backed half; `apps/desktop` (WS6) supplies an
 * Electron-`safeStorage`-backed `Vault` for the GUI shell — same interface,
 * so callers (setup wizard, engine auth, connector tokens) never know which
 * one they're talking to. Secrets are injected only as env vars/headers, never
 * into prompts/events/logs (E4) — enforced by callers, not by the vault itself.
 */
export interface Vault {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

const ALGORITHM = "aes-256-gcm";
const FILE_MODE = 0o600;

/**
 * AES-256-GCM at rest, key material in a sibling 0600 file (`vaultKeyPath`) that
 * never leaves the machine and is generated on first use. Not meant to be
 * portable/interoperable with Electron `safeStorage` — that's fine, each
 * install's vault is local to that install either way.
 */
export class FileVault implements Vault {
  private cache: Record<string, string> | undefined;

  constructor(
    private readonly vaultPath: string,
    private readonly keyPath: string,
  ) {}

  async get(key: string): Promise<string | undefined> {
    const secrets = await this.load();
    return secrets[key];
  }

  async set(key: string, value: string): Promise<void> {
    const secrets = await this.load();
    secrets[key] = value;
    await this.save(secrets);
  }

  async delete(key: string): Promise<void> {
    const secrets = await this.load();
    delete secrets[key];
    await this.save(secrets);
  }

  async list(): Promise<string[]> {
    return Object.keys(await this.load());
  }

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    let raw: Buffer;
    try {
      raw = await readFile(this.vaultPath);
    } catch (err) {
      if (isEnoent(err)) {
        this.cache = {};
        return this.cache;
      }
      throw err;
    }
    const key = await this.loadOrCreateKey();
    const decrypted = decrypt(raw, key);
    this.cache = JSON.parse(decrypted.toString("utf8")) as Record<string, string>;
    return this.cache;
  }

  private async save(secrets: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.vaultPath), { recursive: true });
    const key = await this.loadOrCreateKey();
    const encrypted = encrypt(Buffer.from(JSON.stringify(secrets), "utf8"), key);
    await writeFile(this.vaultPath, encrypted, { mode: FILE_MODE });
    this.cache = secrets;
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    try {
      return await readFile(this.keyPath);
    } catch (err) {
      if (!isEnoent(err)) throw err;
      await mkdir(dirname(this.keyPath), { recursive: true });
      const key = randomBytes(32);
      await writeFile(this.keyPath, key, { mode: FILE_MODE });
      return key;
    }
  }
}

function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

function decrypt(blob: Buffer, key: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const authTag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

/** An in-memory `Vault` for tests — never touches disk. */
export class InMemoryVault implements Vault {
  private readonly secrets = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }

  async list(): Promise<string[]> {
    return [...this.secrets.keys()];
  }
}
