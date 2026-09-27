import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Vault, type SafeStorageLike } from "./vault.js";

function memoryStorage(): SafeStorageLike {
  const store = new Map<string, Buffer>();
  return {
    isEncryptionAvailable: () => true,
    encryptString(plain: string) {
      const buf = Buffer.from(plain, "utf8");
      store.set(buf.toString("hex"), buf);
      return Buffer.from(buf.toString("hex"), "utf8");
    },
    decryptString(encrypted: Buffer) {
      const key = encrypted.toString("utf8");
      const buf = store.get(key);
      if (!buf) throw new Error("missing");
      return buf.toString("utf8");
    },
  };
}

describe("Vault", () => {
  let dir = "";

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips secrets when encryption is available", () => {
    dir = mkdtempSync(join(tmpdir(), "openbot-vault-"));
    const vault = new Vault(join(dir, "vault.bin"), memoryStorage());
    vault.set("typesafe", "secret-key");
    expect(vault.get("typesafe")).toBe("secret-key");
    vault.delete("typesafe");
    expect(vault.get("typesafe")).toBeUndefined();
  });

  it("writes plaintext when encryption is unavailable", () => {
    dir = mkdtempSync(join(tmpdir(), "openbot-vault-"));
    const vault = new Vault(join(dir, "vault-plain.bin"), {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(""),
      decryptString: () => "",
    });
    vault.set("k", "v");
    const again = new Vault(join(dir, "vault-plain.bin"), {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(""),
      decryptString: () => "",
    });
    expect(again.get("k")).toBe("v");
  });
});
