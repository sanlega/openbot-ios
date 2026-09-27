#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
