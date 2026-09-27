import { spawn, type ChildProcess } from "node:child_process";

export interface CloudflareStatus {
  running: boolean;
  hostname?: string;
  accessConfigured?: boolean;
  warning?: string;
}

export interface CloudflareStartResult {
  ok: boolean;
  reason?: string;
  hostname?: string;
  accessWarning?: string;
}

export type SpawnFn = (
  command: string,
  args: string[],
) => ChildProcess;

const defaultSpawn: SpawnFn = (command, args) =>
  spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

/**
 * Cloudflare Tunnel manager (plan §5 WS11 / O2): supervises `cloudflared tunnel
 * run --token` as a child process and warns when Cloudflare Access is missing.
 */
export class CloudflareManager {
  private child: ChildProcess | undefined;
  private lastHostname: string | undefined;
  private accessConfigured = false;

  constructor(
    private readonly spawnFn: SpawnFn = defaultSpawn,
    private readonly command = "cloudflared",
  ) {}

  get running(): boolean {
    return Boolean(this.child && !this.child.killed);
  }

  async validateToken(token?: string): Promise<{ ok: boolean; reason?: string }> {
    if (!token?.trim()) return { ok: false, reason: "tunnel token required" };
    if (token.split(".").length < 3) {
      return { ok: false, reason: "token does not look like a Cloudflare tunnel token" };
    }
    return { ok: true };
  }

  async start(token: string): Promise<CloudflareStartResult> {
    const valid = await this.validateToken(token);
    if (!valid.ok) return { ok: false, reason: valid.reason };

    await this.stop();
    return new Promise((resolve) => {
      const child = this.spawnFn(this.command, ["tunnel", "run", "--token", token]);
      this.child = child;
      let settled = false;

      const finish = (result: CloudflareStartResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        const hostnameMatch = /https:\/\/([^\s]+)/.exec(text);
        if (hostnameMatch) {
          this.lastHostname = hostnameMatch[1];
        }
        if (/access/i.test(text) && /policy|jwt|authenticated/i.test(text)) {
          this.accessConfigured = true;
        }
      });

      child.on("spawn", () => {
        finish({
          ok: true,
          hostname: this.lastHostname,
          accessWarning: this.accessConfigured
            ? undefined
            : "Cloudflare Access policy not detected — tunnel may be reachable without app-level auth until Access is configured",
        });
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (/ERR/i.test(text) && !settled) {
          finish({ ok: false, reason: text.trim() });
        }
        if (/https:\/\/[^\s]+/.test(text)) {
          this.lastHostname = /https:\/\/([^\s]+)/.exec(text)?.[1];
        }
      });

      child.on("error", (error) => {
        finish({ ok: false, reason: error.message });
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.child.kill("SIGTERM");
    this.child = undefined;
  }

  status(): CloudflareStatus {
    const warning =
      this.running && !this.accessConfigured
        ? "Cloudflare Access policy not detected — rely on OpenBot pairing + E2E framing"
        : undefined;
    return {
      running: this.running,
      hostname: this.lastHostname,
      accessConfigured: this.accessConfigured,
      warning,
    };
  }

  /** Test hook: simulate Access detection from faked tunnel logs. */
  setAccessConfigured(configured: boolean): void {
    this.accessConfigured = configured;
  }

  /** Test hook: inject hostname without running cloudflared. */
  setHostname(hostname: string): void {
    this.lastHostname = hostname;
  }
}
