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

export type SpawnFn = (command: string, args: string[]) => ChildProcess;

const defaultSpawn: SpawnFn = (command, args) =>
  spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

/**
 * Cloudflare Tunnel manager (plan §5 WS11 / O2): supervises `cloudflared tunnel
 * run --token` as a child process and warns when Cloudflare Access is missing.
 */
/**
 * A Cloudflare tunnel token is base64 of `{"a": account, "t": tunnel id, "s": secret}`.
 * Also accepts the token pasted inside Cloudflare's install command
 * (`cloudflared service install <token>`); returns the bare token, or undefined.
 */
export function normalizeTunnelToken(input: string): string | undefined {
  const candidate = input.trim().split(/\s+/).pop() ?? "";
  try {
    const parsed = JSON.parse(Buffer.from(candidate, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
    if ([parsed.a, parsed.t, parsed.s].every((v) => typeof v === "string" && v)) return candidate;
  } catch {
    // not base64 JSON; fall through to the legacy shape
  }
  return candidate.split(".").length >= 3 ? candidate : undefined;
}

/**
 * cloudflared logs a remotely-managed tunnel's routes as
 * `Updated to new configuration config="{\"ingress\":[{\"hostname\":\"x.example.com\",...`
 * and prints `https://<random>.trycloudflare.com` for quick tunnels.
 */
export function hostnameFromTunnelLog(text: string): string | undefined {
  const quick = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/i.exec(text);
  if (quick) return quick[1];
  if (!/configuration/i.test(text)) return undefined;
  return /"hostname\\*":\\*"([^"\\]+)/.exec(text)?.[1];
}

export class CloudflareManager {
  private child: ChildProcess | undefined;
  private detectedHostname: string | undefined;
  /** Entered by the owner; wins over whatever the logs revealed. */
  private manualHostname: string | undefined;
  private accessConfigured = false;

  private get lastHostname(): string | undefined {
    return this.manualHostname ?? this.detectedHostname;
  }

  constructor(
    private readonly spawnFn: SpawnFn = defaultSpawn,
    private readonly command = "cloudflared",
    /** Finds (or fetches) the `cloudflared` binary; when set it replaces `command`. */
    private readonly resolveCommand?: () => Promise<string>,
  ) {}

  get running(): boolean {
    return Boolean(this.child && !this.child.killed);
  }

  async validateToken(token?: string): Promise<{ ok: boolean; reason?: string }> {
    if (!token?.trim()) return { ok: false, reason: "tunnel token required" };
    if (!normalizeTunnelToken(token)) {
      return { ok: false, reason: "token does not look like a Cloudflare tunnel token" };
    }
    return { ok: true };
  }

  async start(token: string): Promise<CloudflareStartResult> {
    const valid = await this.validateToken(token);
    if (!valid.ok) return { ok: false, reason: valid.reason };
    token = normalizeTunnelToken(token) ?? token;

    await this.stop();
    let command = this.command;
    if (this.resolveCommand) {
      try {
        command = await this.resolveCommand();
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    }
    return new Promise((resolve) => {
      const child = this.spawnFn(command, ["tunnel", "run", "--token", token]);
      this.child = child;
      let settled = false;

      const finish = (result: CloudflareStartResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        this.detectedHostname = hostnameFromTunnelLog(text) ?? this.detectedHostname;
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
        this.detectedHostname = hostnameFromTunnelLog(text) ?? this.detectedHostname;
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

  /** Drops every remembered hostname (the owner removed the tunnel). */
  forget(): void {
    this.manualHostname = undefined;
    this.detectedHostname = undefined;
    this.accessConfigured = false;
  }

  /** The owner-entered public hostname (kept in network prefs); `undefined` clears it. */
  setManualHostname(hostname: string | undefined): void {
    this.manualHostname = hostname;
  }

  /** Test hook: inject a detected hostname without running cloudflared. */
  setHostname(hostname: string): void {
    this.detectedHostname = hostname;
  }
}
