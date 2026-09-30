import { readFileSync } from "node:fs";

/**
 * The session token the shim presents to the harness. A Codex thread keeps its MCP process across
 * turns, and each turn has a fresh token, so the token is read from a file the harness rewrites
 * per turn (falling back to the env value a fresh process is started with).
 */
export function readSessionToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const file = env.OPENBOT_SESSION_TOKEN_FILE;
  if (file) {
    try {
      const token = readFileSync(file, "utf8").trim();
      if (token) return token;
    } catch {
      // Fall through to the env value.
    }
  }
  return env.OPENBOT_SESSION_TOKEN || undefined;
}
