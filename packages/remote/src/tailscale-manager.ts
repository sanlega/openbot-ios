import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TailscaleStatus {
  installed: boolean;
  version?: string;
  backendState?: string;
  tailnetAddresses: string[];
  serveEnabled: boolean;
  serveUrls: string[];
}

export interface TailscaleEnableResult {
  ok: boolean;
  reason?: string;
  urls: string[];
}

export type ExecFn = (
  command: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: ExecFn = async (command, args) => {
  const result = await execFileAsync(command, args, { encoding: "utf8" });
  return { stdout: result.stdout, stderr: result.stderr };
};

/**
 * Tailscale remote access manager (plan §5 WS11 / O2): detect the CLI, run
 * `tailscale serve --bg` pointed at the harness loopback port, and list tailnet URLs.
 */
export class TailscaleManager {
  constructor(
    private readonly exec: ExecFn = defaultExec,
    private readonly command = "tailscale",
  ) {}

  async detect(): Promise<{ ok: boolean; version?: string; reason?: string }> {
    try {
      const { stdout } = await this.exec(this.command, ["version"]);
      const version = stdout.trim().split(/\s+/)[2] ?? stdout.trim();
      return { ok: true, version };
    } catch {
      return { ok: false, reason: "tailscale CLI not found on PATH" };
    }
  }

  async status(): Promise<TailscaleStatus> {
    const detected = await this.detect();
    if (!detected.ok) {
      return {
        installed: false,
        tailnetAddresses: [],
        serveEnabled: false,
        serveUrls: [],
      };
    }

    try {
      const { stdout } = await this.exec(this.command, ["status", "--json"]);
      const json = JSON.parse(stdout) as {
        BackendState?: string;
        Self?: { TailscaleIPs?: string[] };
      };
      const serve = await this.serveStatus();
      return {
        installed: true,
        version: detected.version,
        backendState: json.BackendState,
        tailnetAddresses: json.Self?.TailscaleIPs ?? [],
        serveEnabled: serve.enabled,
        serveUrls: serve.urls,
      };
    } catch {
      return {
        installed: true,
        version: detected.version,
        tailnetAddresses: [],
        serveEnabled: false,
        serveUrls: [],
      };
    }
  }

  async enable(loopbackPort: number): Promise<TailscaleEnableResult> {
    const detected = await this.detect();
    if (!detected.ok) return { ok: false, reason: detected.reason, urls: [] };
    try {
      await this.exec(this.command, ["serve", "--bg", `http://127.0.0.1:${loopbackPort}`]);
      const serve = await this.serveStatus();
      return { ok: true, urls: serve.urls };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "tailscale serve failed",
        urls: [],
      };
    }
  }

  async disable(): Promise<{ ok: boolean; reason?: string }> {
    try {
      await this.exec(this.command, ["serve", "reset"]);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "tailscale serve reset failed",
      };
    }
  }

  async validateKey(_value?: string): Promise<{ ok: boolean; reason?: string }> {
    const detected = await this.detect();
    return detected.ok
      ? { ok: true }
      : { ok: false, reason: detected.reason ?? "tailscale not installed" };
  }

  private async serveStatus(): Promise<{ enabled: boolean; urls: string[] }> {
    try {
      const { stdout } = await this.exec(this.command, ["serve", "status", "--json"]);
      const json = JSON.parse(stdout) as {
        TCP?: Record<string, { Web?: { URLs?: string[] } }>;
      };
      const urls: string[] = [];
      for (const entry of Object.values(json.TCP ?? {})) {
        if (entry.Web?.URLs) urls.push(...entry.Web.URLs);
      }
      return { enabled: urls.length > 0, urls };
    } catch {
      return { enabled: false, urls: [] };
    }
  }
}
