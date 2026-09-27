#!/usr/bin/env node
/**
 * CI smoke test for the unsigned Linux desktop package (`electron-builder --dir`).
 * Launches the packaged app under xvfb, waits for the harness, and checks `/app`.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDir = join(desktopRoot, "release");
const port = 4577;

async function findLinuxUnpackedDir() {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const unpacked = entries.find((e) => e.isDirectory() && e.name.endsWith("-unpacked"));
  if (!unpacked) {
    throw new Error(`No *-unpacked directory under ${releaseDir}`);
  }
  return join(releaseDir, unpacked.name);
}

async function findLinuxExecutable(unpackedDir) {
  const preferred = join(unpackedDir, "openbot");
  try {
    await import("node:fs/promises").then(({ access }) => access(preferred));
    return preferred;
  } catch {
    const entries = await readdir(unpackedDir, { withFileTypes: true });
    const exe = entries.find(
      (e) =>
        e.isFile() &&
        e.name !== "chrome-sandbox" &&
        !e.name.startsWith("chrome_") &&
        !e.name.startsWith("lib") &&
        !e.name.endsWith(".pak"),
    );
    if (!exe) {
      throw new Error(`No Linux executable found in ${unpackedDir}`);
    }
    return join(unpackedDir, exe.name);
  }
}

function resolvePwaStaticRoot() {
  const pwaIndex = require.resolve("@openbot/pwa");
  return join(dirname(dirname(pwaIndex)), "static");
}

async function waitForHarness(baseUrl, timeoutMs = 60_000) {
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
  const binary = await findLinuxExecutable(unpacked);
  const openbotHome = await mkdtemp(join(tmpdir(), "openbot-packaged-smoke-"));
  const baseUrl = `http://127.0.0.1:${port}`;

  const env = {
    ...process.env,
    OPENBOT_HOME: openbotHome,
    PORT: String(port),
    OPENBOT_FAKE_JEV: "1",
    OPENBOT_FAKE_ENGINES: "1",
    OPENBOT_FAKE_COMPUTER: "1",
    OPENBOT_FAKE_COMPOSIO: "1",
    OPENBOT_PWA_STATIC_ROOT: resolvePwaStaticRoot(),
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  };

  const child = spawn(binary, ["--no-sandbox"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHarness(baseUrl);
    const appRes = await fetch(`${baseUrl}/app`);
    if (!appRes.ok) {
      throw new Error(`/app returned ${appRes.status}`);
    }
    const html = await appRes.text();
    if (!html.includes("root") && !html.includes("<!DOCTYPE html>")) {
      throw new Error("/app did not return HTML");
    }
    console.log("Packaged smoke OK: harness connected and /app served");
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
    if (child.exitCode && child.exitCode !== 0 && !stderr.includes("GPU")) {
      console.error(stderr);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
