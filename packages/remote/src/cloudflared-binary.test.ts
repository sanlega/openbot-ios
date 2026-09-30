import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cloudflaredAsset, ensureCloudflared } from "./cloudflared-binary.js";

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openbot-cf-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const noPath = async () => undefined;

describe("ensureCloudflared", () => {
  it("prefers a cloudflared already on PATH and downloads nothing", async () => {
    const fetchFn = (async () => {
      throw new Error("must not fetch");
    }) as unknown as typeof fetch;
    const result = await ensureCloudflared({
      binDir: await tempDir(),
      findOnPath: async () => "/usr/bin/cloudflared",
      fetchFn,
    });
    expect(result).toBe("/usr/bin/cloudflared");
  });

  it("rejects a download whose hash does not match the pinned one", async () => {
    const fetchFn = (async () => new Response(Buffer.from("tampered"))) as unknown as typeof fetch;
    await expect(
      ensureCloudflared({
        binDir: await tempDir(),
        platform: "linux",
        arch: "x64",
        findOnPath: noPath,
        fetchFn,
      }),
    ).rejects.toThrow(/integrity check/);
  });

  it("reports a clear error when the download fails", async () => {
    const fetchFn = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(
      ensureCloudflared({
        binDir: await tempDir(),
        platform: "linux",
        arch: "x64",
        findOnPath: noPath,
        fetchFn,
      }),
    ).rejects.toThrow(/couldn't download cloudflared \(HTTP 404\)/);
  });

  it("says so on a platform it has no build for", async () => {
    await expect(
      ensureCloudflared({
        binDir: await tempDir(),
        platform: "freebsd",
        arch: "x64",
        findOnPath: noPath,
      }),
    ).rejects.toThrow(/can't download it for freebsd/);
  });

  it("maps every supported platform to an asset, Windows arm64 to the x64 build", () => {
    for (const key of ["win32-x64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]) {
      const [platform, arch] = key.split("-") as [string, string];
      expect(cloudflaredAsset(platform, arch)?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(cloudflaredAsset("win32", "arm64")?.name).toBe("cloudflared-windows-amd64.exe");
  });

  it("downloads, verifies, and caches a matching binary", async () => {
    // Real hashes are pinned, so patch the Windows asset's hash to that of the fake body. The
    // file is written as-is on Windows (no extraction), so any matching bytes work.
    const asset = cloudflaredAsset("win32", "x64")!;
    const body = Buffer.from("fake cloudflared");
    const real = asset.sha256;
    asset.sha256 = createHash("sha256").update(body).digest("hex");
    try {
      const binDir = await tempDir();
      let calls = 0;
      const fetchFn = (async () => {
        calls += 1;
        return new Response(body);
      }) as unknown as typeof fetch;
      const options = { binDir, platform: "win32", arch: "x64", findOnPath: noPath, fetchFn };
      const first = await ensureCloudflared(options);
      expect((await readFile(first)).toString()).toBe("fake cloudflared");
      expect(await ensureCloudflared(options)).toBe(first);
      expect(calls).toBe(1);
    } finally {
      asset.sha256 = real;
    }
  });
});
