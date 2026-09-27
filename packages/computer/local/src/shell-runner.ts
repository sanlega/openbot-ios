import { spawn } from "node:child_process";
import type { ShellRunner } from "./driver-types.js";

export function createShellRunner(): ShellRunner {
  return {
    run(command, args, env = process.env) {
      return new Promise((resolve) => {
        const child = spawn(command, args, { env, shell: process.platform === "win32" });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr?.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      });
    },
  };
}
