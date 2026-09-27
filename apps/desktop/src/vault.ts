import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** OS keychain-backed secret store (plan §2.3 E4). Falls back to a 0600 file when headless. */
export class Vault {
  constructor(
    private readonly vaultPath: string,
    private readonly storage: SafeStorageLike,
  ) {}

  isAvailable(): boolean {
    return this.storage.isEncryptionAvailable();
  }

  get(key: string): string | undefined {
    const data = this.readAll();
    return data[key];
  }

  set(key: string, value: string): void {
    const data = this.readAll();
    data[key] = value;
    this.writeAll(data);
  }

  delete(key: string): void {
    const data = this.readAll();
    delete data[key];
    this.writeAll(data);
  }

  private readAll(): Record<string, string> {
    if (!existsSync(this.vaultPath)) return {};
    const raw = readFileSync(this.vaultPath);
    if (raw.length === 0) return {};
    if (!this.storage.isEncryptionAvailable()) {
      return JSON.parse(raw.toString("utf8")) as Record<string, string>;
    }
    const plain = this.storage.decryptString(raw);
    return JSON.parse(plain) as Record<string, string>;
  }

  private writeAll(data: Record<string, string>): void {
    mkdirSync(dirname(this.vaultPath), { recursive: true });
    const json = JSON.stringify(data);
    if (!this.storage.isEncryptionAvailable()) {
      writeFileSync(this.vaultPath, json, { mode: 0o600 });
      return;
    }
    const encrypted = this.storage.encryptString(json);
    writeFileSync(this.vaultPath, encrypted, { mode: 0o600 });
  }
}
