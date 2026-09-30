import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Pinned so a download is always checked against a hash we reviewed. Bump both together. */
export const CLOUDFLARED_VERSION = "2026.9.3";
const RELEASE_BASE = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;

export interface CloudflaredAsset {
  name: string;
  sha256: string;
  /** The download is a `.tgz` holding a single `cloudflared` executable. */
  tgz?: boolean;
}

const WINDOWS_X64: CloudflaredAsset = {
  name: "cloudflared-windows-amd64.exe",
  sha256: "f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2",
};

const ASSETS: Record<string, CloudflaredAsset> = {
  "win32-x64": WINDOWS_X64,
  // Cloudflare ships no native Windows arm64 build; the x64 one runs under emulation.
  "win32-arm64": WINDOWS_X64,
  "linux-x64": {
    name: "cloudflared-linux-amd64",
    sha256: "77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2",
  },
  "linux-arm64": {
    name: "cloudflared-linux-arm64",
    sha256: "aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d",
  },
  "darwin-x64": {
    name: "cloudflared-darwin-amd64.tgz",
    sha256: "d1155d0837487f261183b15c1eab6c4ebcad9dc49b94675f1524c3564cea3977",
    tgz: true,
  },
  "darwin-arm64": {
    name: "cloudflared-darwin-arm64.tgz",
    sha256: "587c2cfb1c230fe36c7fa7727da78be459dae028cabe8c001291999350f07095",
    tgz: true,
  },
};

export function cloudflaredAsset(
  platform: string = process.platform,
  arch: string = process.arch,
): CloudflaredAsset | undefined {
  return ASSETS[`${platform}-${arch}`];
}

export interface EnsureCloudflaredOptions {
  /** Where a downloaded copy lives (e.g. `~/.openbot/bin`). */
  binDir: string;
  platform?: string;
  arch?: string;
  fetchFn?: typeof fetch;
  /** Finds an already-installed `cloudflared`; defaults to `where`/`which`. */
  findOnPath?: () => Promise<string | undefined>;
}

async function defaultFindOnPath(platform: string): Promise<string | undefined> {
  try {
    const { stdout } = await run(platform === "win32" ? "where" : "which", ["cloudflared"]);
    return stdout
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim();
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a runnable `cloudflared`: one already on PATH, else a copy downloaded once from
 * Cloudflare's GitHub release into `binDir` and checked against a pinned SHA-256.
 */
export async function ensureCloudflared(options: EnsureCloudflaredOptions): Promise<string> {
  const platform = options.platform ?? process.platform;
  const onPath = await (options.findOnPath ?? (() => defaultFindOnPath(platform)))();
  if (onPath) return onPath;

  const asset = cloudflaredAsset(platform, options.arch);
  if (!asset) {
    throw new Error(
      `cloudflared is not installed and OpenBot can't download it for ${platform}/${options.arch ?? process.arch}. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`,
    );
  }

  const target = join(
    options.binDir,
    `cloudflared-${CLOUDFLARED_VERSION}${platform === "win32" ? ".exe" : ""}`,
  );
  if (await exists(target)) return target;

  const doFetch = options.fetchFn ?? fetch;
  let bytes: Buffer;
  try {
    const response = await doFetch(`${RELEASE_BASE}/${asset.name}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(
      `couldn't download cloudflared (${error instanceof Error ? error.message : String(error)}). Check your internet connection, or install it yourself.`,
      { cause: error },
    );
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.sha256) {
    throw new Error("downloaded cloudflared failed its integrity check and was discarded");
  }

  await mkdir(options.binDir, { recursive: true });
  const workDir = await mkdtemp(join(options.binDir, ".download-"));
  try {
    let binary = join(workDir, asset.name);
    await writeFile(binary, bytes);
    if (asset.tgz) {
      await run("tar", ["-xzf", binary, "-C", workDir]);
      binary = join(workDir, "cloudflared");
    }
    if (platform !== "win32") await chmod(binary, 0o755);
    await rename(binary, target);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  return target;
}
