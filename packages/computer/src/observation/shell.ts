import { spawn } from "node:child_process";
import type { ShellExec } from "./types.js";

export function createShellExec(): ShellExec {
  return {
    run(cmd, args, env = process.env) {
      return new Promise((resolve) => {
        const child = spawn(cmd, args, { env });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("close", (code) => {
          resolve({ code: code ?? 1, stdout, stderr });
        });
      });
    },
  };
}
