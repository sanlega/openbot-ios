#!/usr/bin/env node
/**
 * CI smoke test for the unsigned Linux desktop package (`electron-builder --dir`).
 * Extracts the app asar and runs the bundled harness with Electron's Node ABI,
 * then checks `/api/harness/status` and `/app`.
 */
import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(desktopRoot));
const releaseDir = join(desktopRoot, "release");
const asarPkg = readdirSync(join(repoRoot, "node_modules", ".pnpm")).find((n) =>
  n.startsWith("@electron+asar@"),
);
if (!asarPkg) throw new Error("@electron/asar not found");
const asarCli = join(
  repoRoot,
  "node_modules",
  ".pnpm",
  asarPkg,
  "node_modules",
  "@electron",
  "asar",
  "bin",
  "asar.js",
);
const port = 4577;

async function findLinuxUnpackedDir() {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const unpacked = entries.find((e) => e.isDirectory() && e.name.endsWith("-unpacked"));
  if (!unpacked) {
    throw new Error(`No *-unpacked directory under ${releaseDir}`);
  }
  return join(releaseDir, unpacked.name);
}

async function waitForHarness(baseUrl, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/harness/status`);
      if (res.ok) {
        const body = await res.json();
        if (body.connected) return;
      }
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Packaged harness did not become ready");
}

async function main() {
  const unpacked = await findLinuxUnpackedDir();
  const binary = join(unpacked, "openbot");
  const asarPath = join(unpacked, "resources", "app.asar");
  const extractDir = await mkdtemp(join(tmpdir(), "openbot-packaged-smoke-"));
  const openbotHome = await mkdtemp(join(tmpdir(), "openbot-packaged-home-"));
  const baseUrl = `http://127.0.0.1:${port}`;

  const extract = spawnSync(process.execPath, [asarCli, "extract", asarPath, extractDir], {
    stdio: "inherit",
  });
  if (extract.status !== 0) {
    throw new Error("Failed to extract app.asar");
  }

  const harnessEntry = join(extractDir, "dist", "harness.mjs");
  const pwaStatic = join(extractDir, "node_modules", "@openbot", "pwa", "static");

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    OPENBOT_HOME: openbotHome,
    PORT: String(port),
    OPENBOT_FAKE_JEV: "1",
    OPENBOT_FAKE_ENGINES: "1",
    OPENBOT_FAKE_COMPUTER: "1",
    OPENBOT_FAKE_COMPOSIO: "1",
    OPENBOT_PWA_STATIC_ROOT: pwaStatic,
    NODE_PATH: join(extractDir, "node_modules"),
  };

  const child = spawn(binary, [harnessEntry, "serve"], {
    env,
    cwd: extractDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  let stdout = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  const childExit = new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });

  try {
    const ready = waitForHarness(baseUrl);
    const earlyExit = childExit.then(({ code, signal }) => {
      if (code !== 0 && code !== null) {
        throw new Error(`Harness process exited early (code=${code}, signal=${signal})`);
      }
    });
    await Promise.race([ready, earlyExit]);
    await ready;
    const appRes = await fetch(`${baseUrl}/app`);
    if (!appRes.ok) {
      throw new Error(`/app returned ${appRes.status}`);
    }
    const html = await appRes.text();
    if (!html.includes("root") && !html.includes("<!DOCTYPE html>")) {
      throw new Error("/app did not return HTML");
    }
    console.log("Packaged smoke OK: harness connected and /app served");
  } catch (err) {
    if (stdout) console.error(stdout);
    if (stderr) console.error(stderr);
    throw err;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
    });
    await rm(openbotHome, { recursive: true, force: true });
    await rm(extractDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
