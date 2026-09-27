import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(root));
const uiRoot = join(repoRoot, "packages", "ui");
const staticDir = join(root, "static");
const uiDist = join(uiRoot, "dist", "app");
const legacyStatic = join(root, "src", "static");

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

await run(
  process.execPath,
  [join(uiRoot, "node_modules", "vite", "bin", "vite.js"), "build"],
  uiRoot,
);

await rm(staticDir, { recursive: true, force: true });
await mkdir(staticDir, { recursive: true });
await cp(uiDist, staticDir, { recursive: true });

for (const file of ["manifest.webmanifest", "sw.js"]) {
  try {
    await cp(join(legacyStatic, file), join(staticDir, file));
  } catch {
    // Optional legacy PWA assets.
  }
}

console.log(`WS5 UI built and copied to ${staticDir}`);
