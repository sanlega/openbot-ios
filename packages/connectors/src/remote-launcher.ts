#!/usr/bin/env node
/**
 * Stdio bridge for a remote (HTTP) MCP server: runs `mcp-remote <url>` with
 * the connection's headers. Header values arrive through env
 * (`OPENBOT_REMOTE_HEADER_<i>`) and are passed to mcp-remote as
 * `Name:${OPENBOT_REMOTE_HEADER_<i>}`, which mcp-remote expands itself, so a
 * token never appears in any process's argv, and engines that expand `${…}`
 * in their own MCP config never see a placeholder.
 */
import { spawn } from "node:child_process";

const url = process.env.OPENBOT_REMOTE_URL;
if (!url) {
  process.stderr.write("openbot remote launcher: OPENBOT_REMOTE_URL is not set\n");
  process.exit(2);
}

const names = (process.env.OPENBOT_REMOTE_HEADER_NAMES ?? "").split(",").filter(Boolean);
const args = ["-y", "mcp-remote", url];
names.forEach((name, i) => {
  if (process.env[`OPENBOT_REMOTE_HEADER_${i}`] !== undefined) {
    args.push("--header", `${name}:\${OPENBOT_REMOTE_HEADER_${i}}`);
  }
});

const windows = process.platform === "win32";
const child = spawn(windows ? "npx.cmd" : "npx", args, {
  stdio: "inherit",
  env: process.env,
  // Node refuses to spawn .cmd files without a shell; no argument has spaces.
  shell: windows,
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on("error", (error) => {
  process.stderr.write(`openbot remote launcher: ${error.message}\n`);
  process.exit(1);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
