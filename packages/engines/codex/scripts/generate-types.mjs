#!/usr/bin/env node
/**
 * Regenerate TS bindings when bumping codex-cli. CI compares against committed output.
 * Requires `codex app-server generate-ts --experimental` on PATH.
 */
import { spawnSync } from "node:child_process";
import { resolveCliCommand } from "../../common/src/cli-path.ts";

const codex = await resolveCliCommand("codex");
if (!codex) {
  console.error("codex CLI not installed; using committed generated/protocol.ts");
  process.exit(0);
}

const out = new URL("../src/generated/", import.meta.url);
const result = spawnSync(
  codex,
  ["app-server", "generate-ts", "--out", out.pathname, "--experimental"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
