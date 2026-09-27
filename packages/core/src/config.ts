import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolved filesystem layout under `OPENBOT_HOME` (plan §3, default `~/.openbot`)
 * and network settings for the Client API (plan §4.7/§5 WS1). Every path here is
 * a plain string so `apps/desktop` (Electron `utilityProcess`) and `apps/server`
 * (headless `openbot serve`) share exactly one source of truth.
 */
export interface CoreConfig {
  /** `OPENBOT_HOME`; default `~/.openbot`. */
  openbotHome: string;
  dbPath: string;
  logsThreadsDir: string;
  workspaceDir: string;
  uploadsDir: string;
  trashDir: string;
  vaultPath: string;
  vaultKeyPath: string;
  deviceSecretPath: string;
  modelsPath: string;
  screensDir: string;
  routinesDir: string;
  /** Client API HTTP port; default 4577 (kept from WS0's `apps/server` skeleton). */
  port: number;
}

/**
 * Live flags (not static config) that gate loopback-only binding (plan §4.8,
 * WS1 acceptance: "the harness never listens beyond loopback unless remote
 * access and device auth are on"). `remoteEnabled` is derived from
 * `SetupState.tailscale.ok`/`cloudflare.ok` (WS11 sets those once a transport
 * validates); `deviceAuthConfigured` is true once at least one non-revoked
 * device is paired. Computed fresh at boot (and by tests) rather than stored
 * on `CoreConfig`, since both can change at runtime without a config reload.
 */
export interface BindHostFlags {
  remoteEnabled: boolean;
  deviceAuthConfigured: boolean;
}

export interface LoadConfigOptions {
  env?: Record<string, string | undefined>;
  overrides?: Partial<CoreConfig>;
}

const DEFAULT_PORT = 4577;

/** Reads `OPENBOT_HOME`/`PORT` from `env` (defaults to `process.env`) and derives every data-dir path (plan §3). */
export function loadConfig(options: LoadConfigOptions = {}): CoreConfig {
  const env = options.env ?? process.env;
  const openbotHome = env.OPENBOT_HOME?.trim() || join(homedir(), ".openbot");
  const port = Number(env.PORT ?? DEFAULT_PORT) || DEFAULT_PORT;

  const base: CoreConfig = {
    openbotHome,
    dbPath: join(openbotHome, "openbot.db"),
    logsThreadsDir: join(openbotHome, "logs", "threads"),
    workspaceDir: join(openbotHome, "workspace"),
    uploadsDir: join(openbotHome, "uploads"),
    trashDir: join(openbotHome, "trash"),
    vaultPath: join(openbotHome, "vault.bin"),
    vaultKeyPath: join(openbotHome, "vault.key"),
    deviceSecretPath: join(openbotHome, "device-secret"),
    modelsPath: join(openbotHome, "models.json"),
    screensDir: join(openbotHome, "screens"),
    routinesDir: join(openbotHome, "routines"),
    port,
  };

  return { ...base, ...options.overrides };
}

/**
 * The harness binds to loopback only, unless remote access is enabled AND at
 * least one device is paired (device auth configured) — plan §4.8/§5 WS1
 * acceptance. Both conditions are required: enabling remote access alone,
 * with no device auth, must not expose the API.
 */
export function resolveBindHost(flags: BindHostFlags): string {
  return flags.remoteEnabled && flags.deviceAuthConfigured ? "0.0.0.0" : "127.0.0.1";
}
