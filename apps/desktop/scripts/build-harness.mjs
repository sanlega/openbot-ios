#!/usr/bin/env node
import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const serverMain = join(desktopRoot, "..", "server", "src", "main.ts");
const outfile = join(desktopRoot, "dist", "harness.mjs");

await esbuild.build({
  entryPoints: [serverMain],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  // Keep npm + workspace packages external (resolved from packaged node_modules).
  packages: "external",
  logLevel: "info",
});

console.log(`Harness bundle written to ${outfile}`);
