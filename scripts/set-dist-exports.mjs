#!/usr/bin/env node
/**
 * One-shot maintainer script: point workspace package exports at dist/ with an
 * optional `development` condition for TypeScript sources.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** @param {string} distPath e.g. "./dist/index.js" */
function entry(distPath, srcPath) {
  const typesPath = distPath.replace(/\.js$/, ".d.ts");
  return {
    development: srcPath,
    types: typesPath,
    import: distPath,
    default: distPath,
  };
}

/** @param {Record<string, string>} subpaths dist -> src */
function applyExports(pkg, subpaths) {
  const keys = Object.keys(subpaths);
  const primary = subpaths["."] ?? subpaths[keys[0]];
  const primaryDist = keys.find((k) => k === ".") ?? keys[0];
  pkg.main = subpaths[primaryDist].replace("./src", "./dist").replace(/\.ts$/, ".js");
  pkg.types = pkg.main.replace(/\.js$/, ".d.ts");
  pkg.exports = {};
  for (const [sub, src] of Object.entries(subpaths)) {
    const dist = src
      .replace("./src/", "./dist/")
      .replace(/\.ts$/, ".js")
      .replace("./src/index.ts", "./dist/index.js");
    pkg.exports[sub] = entry(dist, src);
  }
  return pkg;
}

const packages = [
  { path: "packages/contracts/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/store/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/testkit/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/runtime/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/core/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/decisions/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/cos/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/mcp/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/remote/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/routines/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/connectors/package.json", exports: { ".": "./src/index.ts" } },
  {
    path: "packages/computer/package.json",
    exports: { ".": "./src/index.ts", "./observation": "./src/observation/index.ts" },
  },
  { path: "packages/computer/docker/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/computer/fake/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/computer/local/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/engines/common/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/engines/claude/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/engines/codex/package.json", exports: { ".": "./src/index.ts" } },
  { path: "packages/engines/fake/package.json", exports: { ".": "./src/index.ts" } },
  {
    path: "packages/ui/package.json",
    exports: { ".": "./src/index.ts", "./mock": "./src/mock/index.ts" },
  },
  { path: "apps/pwa/package.json", exports: { ".": "./src/index.ts" } },
];

for (const spec of packages) {
  const filePath = join(repoRoot, spec.path);
  const pkg = JSON.parse(readFileSync(filePath, "utf8"));
  applyExports(pkg, spec.exports);
  if (spec.path === "packages/ui/package.json") {
    pkg.exports["./styles.css"] = "./src/styles/global.css";
  }
  writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

// @openbot/server — add development condition to existing dist exports
const serverPath = join(repoRoot, "apps/server/package.json");
const serverPkg = JSON.parse(readFileSync(serverPath, "utf8"));
for (const [sub, value] of Object.entries(serverPkg.exports)) {
  if (typeof value === "object" && value.import) {
    const src = sub === "." ? "./src/index.ts" : `./src${sub.slice(1)}.ts`;
    value.development = src;
  }
}
serverPkg.exports["."].development = "./src/index.ts";
serverPkg.exports["./bootstrap"].development = "./src/bootstrap.ts";
writeFileSync(serverPath, `${JSON.stringify(serverPkg, null, 2)}\n`);

console.log(`Updated ${packages.length + 1} package.json files.`);
