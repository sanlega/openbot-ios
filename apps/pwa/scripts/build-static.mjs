import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const staticDir = join(root, "static");
const srcDir = join(root, "src", "static");

await mkdir(staticDir, { recursive: true });
await cp(srcDir, staticDir, { recursive: true });
console.log(`PWA static assets copied to ${staticDir}`);
