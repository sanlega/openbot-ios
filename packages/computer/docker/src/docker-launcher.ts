import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type DockerUnavailableReason = "not_installed" | "not_running" | "start_timeout";

/** Docker isn't usable, with a message written for the person, not a socket error. */
export class DockerUnavailableError extends Error {
  constructor(
    readonly reason: DockerUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = "DockerUnavailableError";
  }
}

export interface DockerLauncherDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  /** Starts a program and returns without waiting for it. */
  launch?: (command: string, args: string[]) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long to wait for the engine after launching Docker Desktop. */
  timeoutMs?: number;
  pollMs?: number;
}

const INSTALL_URL = "https://www.docker.com/products/docker-desktop/";

function defaultLaunch(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}

/** What starts Docker on this machine, or undefined when it isn't installed. */
export function dockerDesktopLaunch(
  deps: DockerLauncherDeps = {},
): { command: string; args: string[] } | undefined {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env.ProgramW6432, "C:\\Program Files"].filter(
      (root): root is string => Boolean(root),
    );
    for (const root of roots) {
      const exe = join(root, "Docker", "Docker", "Docker Desktop.exe");
      if (exists(exe)) return { command: exe, args: [] };
    }
    return undefined;
  }
  if (platform === "darwin") {
    return exists("/Applications/Docker.app")
      ? { command: "open", args: ["-a", "Docker"] }
      : undefined;
  }
  return undefined;
}

/**
 * Makes sure the Docker engine answers. If it doesn't, starts Docker Desktop (Windows/macOS)
 * and waits for it; otherwise says plainly what to do. Never falls back to anything else.
 */
export async function ensureDockerEngine(
  ping: () => Promise<void>,
  deps: DockerLauncherDeps = {},
): Promise<{ started: boolean }> {
  try {
    await ping();
    return { started: false };
  } catch {
    // Not answering: work out why below.
  }

  const platform = deps.platform ?? process.platform;
  const target = dockerDesktopLaunch(deps);
  if (!target) {
    if (platform === "win32" || platform === "darwin") {
      throw new DockerUnavailableError(
        "not_installed",
        `Docker Desktop isn't installed, and OpenBot's virtual computer needs it. Install it from ${INSTALL_URL} and try again.`,
      );
    }
    throw new DockerUnavailableError(
      "not_running",
      "Docker isn't running. Start the Docker service (for example `sudo systemctl start docker`) and try again.",
    );
  }

  (deps.launch ?? defaultLaunch)(target.command, target.args);

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.timeoutMs ?? 120_000);
  while (now() < deadline) {
    await sleep(deps.pollMs ?? 2_000);
    try {
      await ping();
      return { started: true };
    } catch {
      // Still starting.
    }
  }
  throw new DockerUnavailableError(
    "start_timeout",
    "OpenBot started Docker Desktop but it didn't finish starting in time. Open Docker Desktop, wait until it says it's running, and try again.",
  );
}
