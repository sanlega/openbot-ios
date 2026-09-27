import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileVault, InMemoryVault } from "./vault.js";

/**
 * WS1 required test: "vault round-trip on all three OSes." Every path used
 * here comes from `node:os`/`node:path`, and the encryption is plain Node
 * `crypto` (AES-256-GCM) — nothing platform-specific — so this test's
 * assertions hold unchanged on Linux, macOS, and Windows; the CI matrix
 * (`.github/workflows/ci.yml`) is what actually exercises all three.
 */
describe("FileVault", () => {
  async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "openbot-vault-test-"));
    try {
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("round-trips a secret through disk (new FileVault instance, same paths)", async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, "vault.bin");
      const keyPath = join(dir, "vault.key");

      const writer = new FileVault(vaultPath, keyPath);
      await writer.set("openai.apiKey", "sk-super-secret-value");

      // A brand-new instance (simulating a process restart) must decrypt what the first instance wrote.
      const reader = new FileVault(vaultPath, keyPath);
      await expect(reader.get("openai.apiKey")).resolves.toBe("sk-super-secret-value");
    });
  });

  it("supports get/set/delete/list, and never stores secrets in plaintext on disk", async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, "vault.bin");
      const keyPath = join(dir, "vault.key");
      const vault = new FileVault(vaultPath, keyPath);

      await vault.set("anthropic.apiKey", "sk-ant-abc123");
      await vault.set("composio.token", "composio-xyz789");
      expect(new Set(await vault.list())).toEqual(new Set(["anthropic.apiKey", "composio.token"]));

      await vault.delete("composio.token");
      expect(await vault.list()).toEqual(["anthropic.apiKey"]);
      expect(await vault.get("composio.token")).toBeUndefined();

      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(vaultPath, "utf8").catch(() => undefined as unknown as string);
      // The file is binary ciphertext; the secret's plaintext must not appear in it verbatim.
      expect(raw?.includes("sk-ant-abc123") ?? false).toBe(false);
    });
  });

  it("writes the vault and key files with owner-only (0600) permissions", async () => {
    await withTempDir(async (dir) => {
      if (process.platform === "win32") return; // POSIX file modes don't apply on Windows.
      const vaultPath = join(dir, "vault.bin");
      const keyPath = join(dir, "vault.key");
      const vault = new FileVault(vaultPath, keyPath);
      await vault.set("k", "v");

      const vaultMode = (await stat(vaultPath)).mode & 0o777;
      const keyMode = (await stat(keyPath)).mode & 0o777;
      expect(vaultMode).toBe(0o600);
      expect(keyMode).toBe(0o600);
    });
  });

  it("get() on a missing vault file returns undefined instead of throwing", async () => {
    await withTempDir(async (dir) => {
      const vault = new FileVault(join(dir, "does-not-exist.bin"), join(dir, "does-not-exist.key"));
      await expect(vault.get("anything")).resolves.toBeUndefined();
      await expect(vault.list()).resolves.toEqual([]);
    });
  });
});

describe("InMemoryVault", () => {
  it("round-trips get/set/delete/list without touching disk", async () => {
    const vault = new InMemoryVault();
    await vault.set("a", "1");
    await vault.set("b", "2");
    expect(new Set(await vault.list())).toEqual(new Set(["a", "b"]));
    await expect(vault.get("a")).resolves.toBe("1");
    await vault.delete("a");
    await expect(vault.get("a")).resolves.toBeUndefined();
  });
});
