#!/usr/bin/env node
/**
 * CI smoke test for the macOS desktop package (`electron-builder --dir`): the app must carry a
 * valid (ad-hoc) signature, and the packaged app itself must start and serve its harness.
 * Before this, macOS packages were built but never run, and a release shipped an unsigned
 * bundle that Apple Silicon Macs refuse to open.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDir = join(desktopRoot, "release");
const port = 4577;

function findApp() {
  for (const dir of readdirSync(releaseDir)) {
    if (!dir.startsWith("mac")) continue;
    const app = readdirSync(join(releaseDir, dir)).find((n) => n.endsWith(".app"));
    if (app) return join(releaseDir, dir, app);
  }
  throw new Error(`No mac*/*.app under ${releaseDir}`);
}

async function waitFor(url, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not answer in time`);
}

async function main() {
  const app = findApp();
  console.log("app:", app);
  if (!existsSync(join(app, "Contents", "_CodeSignature", "CodeResources"))) {
    throw new Error("The app bundle is not signed (no _CodeSignature)");
  }
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], {
    stdio: "inherit",
  });

  const home = await mkdtemp(join(tmpdir(), "openbot-mac-smoke-"));
  const exe = join(app, "Contents", "MacOS", readdirSync(join(app, "Contents", "MacOS"))[0]);
  const child = spawn(exe, [], {
    env: { ...process.env, OPENBOT_HOME: home, PORT: String(port) },
    stdio: "inherit",
  });
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });
  try {
    const status = await (await waitFor(`http://127.0.0.1:${port}/api/harness/status`)).json();
    if (!status.connected) throw new Error(`harness not connected: ${JSON.stringify(status)}`);
    await waitFor(`http://127.0.0.1:${port}/app/`);
    if (exited) throw new Error(`the app exited early: ${JSON.stringify(exited)}`);
    console.log("packaged macOS app started, harness", status.version);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 2_000));
    if (!exited) child.kill("SIGKILL");
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
