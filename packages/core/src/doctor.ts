import { execFile } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CoreConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  ok: boolean;
  /** Only `required` checks gate `DoctorReport.ok` — the rest (engine CLIs, container runtime, remote tunnels) are owned by other workstreams and are informational until those are wired in. */
  required: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

/**
 * `openbot doctor` (plan §5 WS1: "checks the CLIs and logins, Docker or
 * Podman, `tailscale` and `cloudflared`, and OS permissions"). WS1 only owns
 * the harness-level checks (data dir permissions); the CLI/login checks are
 * presence-only probes here (real login/version validation is WS3's
 * `validateKey`/`detect`, run through `setup/validate`) so `doctor` gives a
 * useful signal even before WS3/WS9/WS11 land.
 */
export async function runDoctor(config: CoreConfig): Promise<DoctorReport> {
  const checks = await Promise.all([
    checkDataDirWritable(config),
    checkEngineCli("claude", "Claude Code CLI"),
    checkEngineCli("codex", "Codex CLI"),
    checkContainerRuntime(),
    checkCommandOnPath("Tailscale", "tailscale"),
    checkCommandOnPath("cloudflared", "cloudflared"),
  ]);
  return { ok: checks.every((check) => check.ok || !check.required), checks };
}

async function commandExists(command: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    await execFileAsync(probe, [command]);
    return true;
  } catch {
    return false;
  }
}

/** Claude/Codex CLIs are npm-installed shims; on Windows they're `<name>.cmd` (plan §5 WS3 note). */
async function checkEngineCli(command: string, label: string): Promise<DoctorCheck> {
  const candidates = process.platform === "win32" ? [`${command}.cmd`, command] : [command];
  for (const candidate of candidates) {
    if (await commandExists(candidate)) {
      return { name: label, ok: true, required: false, detail: `${candidate} found on PATH` };
    }
  }
  return {
    name: label,
    ok: false,
    required: false,
    detail: `${command} not found on PATH — install it, then re-run \`setup/validate\``,
  };
}

async function checkContainerRuntime(): Promise<DoctorCheck> {
  const docker = await commandExists("docker");
  if (docker)
    return { name: "Container runtime", ok: true, required: false, detail: "docker found on PATH" };
  const podman = await commandExists("podman");
  if (podman)
    return { name: "Container runtime", ok: true, required: false, detail: "podman found on PATH" };
  return {
    name: "Container runtime",
    ok: false,
    required: false,
    detail:
      "neither docker nor podman found on PATH — the sandboxed Computer provider (WS9) needs one",
  };
}

async function checkCommandOnPath(label: string, command: string): Promise<DoctorCheck> {
  const found = await commandExists(command);
  return {
    name: label,
    ok: found,
    required: false,
    detail: found
      ? `${command} found on PATH`
      : `${command} not found on PATH — only needed for remote access (WS11)`,
  };
}

/** The one check WS1 gates `doctor`'s overall `ok` on: every other piece of the harness needs `OPENBOT_HOME` to be writable. */
async function checkDataDirWritable(config: CoreConfig): Promise<DoctorCheck> {
  try {
    await mkdir(config.openbotHome, { recursive: true });
    const probePath = join(config.openbotHome, ".doctor-probe");
    await writeFile(probePath, "ok", "utf8");
    await unlink(probePath);
    return {
      name: "Data directory",
      ok: true,
      required: true,
      detail: `${config.openbotHome} is writable`,
    };
  } catch (error) {
    return {
      name: "Data directory",
      ok: false,
      required: true,
      detail: `cannot write to ${config.openbotHome}: ${(error as Error).message}`,
    };
  }
}
