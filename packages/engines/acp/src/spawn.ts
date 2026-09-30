import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { runCommand } from "@openbot/engines-common";

export interface SpawnTarget {
  command: string;
  /** Arguments that go before the caller's (a script run by Node or PowerShell). */
  prefixArgs: string[];
  /** Only for shims we could not see through: Node refuses to spawn `.cmd` files without a shell. */
  shell: boolean;
  /** Variables the shim would have set. */
  env?: Record<string, string>;
}

/**
 * Windows puts CLIs behind `.cmd` shims, which Node 22 can only run through a shell (and a shell
 * re-parses every argument). Run what the shim runs instead:
 * - an npm shim names the real target: an `.exe` as is, a `.js` script with this Node;
 * - Cursor's shim runs a PowerShell script that starts the newest `versions/<v>/index.js` with
 *   that version's own Node: run that directly;
 * - any other shim that runs a `.ps1`: PowerShell with `-File`, which passes arguments as is.
 */
export function resolveSpawnTarget(command: string): SpawnTarget {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return { command, prefixArgs: [], shell: false };
  }
  try {
    const text = readFileSync(command, "utf8");
    const dir = dirname(command);
    // The shim may first name `%dp0%\node.exe` (the Node to use); the target is the last path.
    const targets = [...text.matchAll(/"%~?dp0%?\\?([^"%]+\.(exe|js|cjs|mjs))"/gi)]
      .map((m) => m[1]!)
      .filter((p) => !/(^|[\\/])node\.exe$/i.test(p));
    const found = targets.at(-1);
    if (found) {
      const target = join(dir, found);
      return /\.exe$/i.test(target)
        ? { command: target, prefixArgs: [], shell: false }
        : { command: process.execPath, prefixArgs: [target], shell: false };
    }
    const ps1 = /[\\"%]([\w.-]+\.ps1)"/i.exec(text)?.[1];
    if (ps1 && existsSync(join(dir, ps1))) {
      const env = { CURSOR_INVOKED_AS: basename(command) };
      const version = newestVersionDir(join(dir, "versions"));
      if (version) {
        return {
          command: join(version, "node.exe"),
          prefixArgs: [join(version, "index.js")],
          shell: false,
          env,
        };
      }
      return {
        command: join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        prefixArgs: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(dir, ps1)],
        shell: false,
        env,
      };
    }
  } catch {
    // Fall through to the shell.
  }
  return { command, prefixArgs: [], shell: true };
}

/** `versions/2026.09.18-9a7762b` style folders: the newest one that has its own Node and script. */
function newestVersionDir(versions: string): string | undefined {
  if (!existsSync(versions)) return undefined;
  const key = (name: string) => {
    const [date = ""] = name.split("-");
    const [y = "0", m = "0", d = "0"] = date.split(".");
    return `${y.padStart(4, "0")}${m.padStart(2, "0")}${d.padStart(2, "0")}-${name}`;
  };
  const candidates = readdirSync(versions)
    .filter((name) => /^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/.test(name))
    .filter((name) => existsSync(join(versions, name, "node.exe")))
    .filter((name) => existsSync(join(versions, name, "index.js")))
    .sort((a, b) => key(b).localeCompare(key(a)));
  return candidates[0] ? join(versions, candidates[0]) : undefined;
}

/** `runCommand` through `resolveSpawnTarget`, so Windows `.cmd` shims work. */
export async function runCli(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const target = resolveSpawnTarget(command);
  return runCommand(target.command, [...target.prefixArgs, ...args], {
    ...options,
    env: { ...target.env, ...options.env },
  });
}
