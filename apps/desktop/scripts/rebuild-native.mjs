#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(desktopRoot));
const pnpmDir = join(repoRoot, "node_modules", ".pnpm");
const sqlitePkgDir = readdirSync(pnpmDir).find((name) => name.startsWith("better-sqlite3@"));
if (!sqlitePkgDir) {
  console.error("better-sqlite3 not found in pnpm store");
  process.exit(1);
}
const sqliteRoot = join(pnpmDir, sqlitePkgDir, "node_modules", "better-sqlite3");

rmSync(join(sqliteRoot, "prebuilds"), { recursive: true, force: true });
rmSync(join(sqliteRoot, "build"), { recursive: true, force: true });

const result = spawnSync("pnpm", ["exec", "electron-rebuild", "-f", "-w", "better-sqlite3"], {
  cwd: desktopRoot,
  stdio: "inherit",
  shell: true,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const built = join(sqliteRoot, "build", "Release", "better_sqlite3.node");
if (!existsSync(built)) {
  console.error(`Expected Electron rebuild output missing: ${built}`);
  process.exit(1);
}

// A rebuild can succeed even when the addon's Node requirement exceeds the
// Node version bundled by Electron. Test the actual runtime before packaging.
const electronBinary = require("electron");
const probe = spawnSync(
  electronBinary,
  [
    "-e",
    `const Database = require(${JSON.stringify(sqliteRoot)});
     const db = new Database(":memory:");
     if (db.prepare("select 1 as ok").get().ok !== 1) process.exit(1);
     db.close();`,
  ],
  {
    cwd: desktopRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 15_000,
  },
);
if (probe.status !== 0) {
  console.error("better-sqlite3 failed under Electron's embedded Node runtime");
  if (probe.stderr) console.error(probe.stderr);
  process.exit(probe.status || 1);
}
console.log("better-sqlite3 passed the Electron runtime probe");
