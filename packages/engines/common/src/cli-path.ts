import { access } from "node:fs/promises";
import path from "node:path";

/**
 * Resolve a CLI executable, including Windows `.cmd` shims (plan §5 WS3 wizard/doctor).
 */
export async function resolveCliCommand(baseName: string): Promise<string | null> {
  const candidates =
    process.platform === "win32" ? [`${baseName}.cmd`, `${baseName}.exe`, baseName] : [baseName];

  for (const candidate of candidates) {
    const resolved = await findOnPath(candidate);
    if (resolved) return resolved;
  }
  return null;
}

async function findOnPath(command: string): Promise<string | null> {
  const pathEnv = process.env.PATH ?? "";
  const segments = pathEnv.split(path.delimiter).filter(Boolean);
  for (const segment of segments) {
    const full = path.join(segment, command);
    try {
      await access(full);
      return full;
    } catch {
      // keep searching
    }
  }
  return null;
}

export async function runCommand(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer =
      options.timeoutMs != null
        ? setTimeout(() => {
            child.kill();
            reject(new Error(`command timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs)
        : undefined;
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}
