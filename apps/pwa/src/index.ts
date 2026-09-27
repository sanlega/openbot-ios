import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Directory containing PWA static assets served at `/app`. */
export function getPwaStaticRoot(): string {
  return join(packageRoot, "src", "static");
}
