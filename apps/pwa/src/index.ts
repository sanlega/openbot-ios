import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Directory containing the built WS5 UI served at `/app`. */
export function getPwaStaticRoot(): string {
  if (process.env.OPENBOT_PWA_STATIC_ROOT) {
    return process.env.OPENBOT_PWA_STATIC_ROOT;
  }
  return join(packageRoot, "static");
}
