import { mkdir } from "node:fs/promises";
import type {
  Clock,
  ComputerProvider,
  DecisionService,
  EngineId,
  EngineStatus,
  ModelInfo,
  RoutineRun,
  RoutineRunCause,
} from "@openbot/contracts";
import { systemClock } from "@openbot/contracts";
import { readNetworkPrefs } from "@openbot/remote";
import type { RemoteServices } from "@openbot/remote";
import {
  ApprovalsRepo,
  InputRequestsRepo,
  BotsRepo,
  CapCountersRepo,
  ChainsRepo,
  ComputerTasksRepo,
  ConnectionsRepo,
  DecisionsRepo,
  DevicesRepo,
  EngineSessionsRepo,
  EventStore,
  MessagesRepo,
  openDb,
  RoutineRunsRepo,
  RoutinesRepo,
  RulesRepo,
  SettingsRepo,
  SetupStateRepo,
  ThreadsRepo,
  TriggerEventsRepo,
  TurnsRepo,
  type Db,
} from "@openbot/store";
import { type BindHostFlags, type CoreConfig, loadConfig } from "./config.js";
import { DeviceAuth, generateDeviceSecret } from "./device-auth.js";
import { EventBus } from "./event-bus.js";
import { NdjsonWriter, NullNdjsonWriter } from "./ndjson-writer.js";
import { FileVault, type Vault } from "./vault.js";
import type { ConnectorService } from "./connector-service.js";

/** One instance of every WS1 repository, sharing the same `Db` handle. */
export interface CoreRepos {
  bots: BotsRepo;
  threads: ThreadsRepo;
  messages: MessagesRepo;
  chains: ChainsRepo;
  turns: TurnsRepo;
  approvals: ApprovalsRepo;
  inputRequests: InputRequestsRepo;
  rules: RulesRepo;
  devices: DevicesRepo;
  connections: ConnectionsRepo;
  computerTasks: ComputerTasksRepo;
  routines: RoutinesRepo;
  routineRuns: RoutineRunsRepo;
  triggerEvents: TriggerEventsRepo;
  engineSessions: EngineSessionsRepo;
  decisions: DecisionsRepo;
  capCounters: CapCountersRepo;
  settings: SettingsRepo;
  setupState: SetupStateRepo;
}

/** Setup-wizard validation kinds (plan §4.7 `setup/validate`). */
export type SetupValidatorKind =
  "typesafe" | "anthropic" | "openai" | "claude_login" | "codex_login" | "tailscale" | "cloudflare";

export type SetupValidator = (value?: string) => Promise<{ ok: boolean; reason?: string }>;

/** A running or finished computer task as the UI sees it (see @openbot/computer). */
export interface LiveComputerTask {
  taskId: string;
  botId: string;
  goal: string;
  status: string;
  steps: Array<{
    step: number;
    op?: string;
    target?: string;
    outcome: string;
    reason?: string;
    at: string;
  }>;
  pendingInput?: { field: string };
  instructions: string[];
  summary?: string;
  url?: string;
  title?: string;
}

export interface ComputerTasksControl {
  get(taskId: string): LiveComputerTask | undefined;
  steer(
    taskId: string,
    input: { instruction?: string; text?: string },
  ): LiveComputerTask | undefined;
  cancel(taskId: string): LiveComputerTask | undefined;
}

/** WS2 turn control surface for Client API WebSocket commands. */
export interface TurnMailbox {
  enqueue(input: {
    botId: string;
    /** The Bot's DM thread; defaults to it, and must match it when given. */
    threadId?: string;
    /** Continues this chain when it exists; otherwise a new live chain starts. */
    chainId?: string;
    text: string;
    /** Explicit engine override (the route chip); otherwise the Bot's pin or Jev's route. */
    engine?: EngineId;
  }): Promise<{
    ok: boolean;
    reason?: string;
    chainId?: string;
    messageId?: string;
    engine?: EngineId;
    model?: string;
  }>;
  stop(turnId: string): Promise<{ ok: boolean; reason?: string }>;
  /** Stops the Bot's active turn, if any, and drops its queued turns. */
  stopBot(botId: string): Promise<{ ok: boolean; reason?: string }>;
  steer(turnId: string, text: string): Promise<{ ok: boolean; reason?: string }>;
}

/**
 * The service registry every other workstream is meant to depend on instead of
 * reaching into `packages/core`'s or another workstream's internals (plan §3:
 * "Cross-package imports go only through `@openbot/contracts` and the
 * `CoreContext` service registry"). WS3/WS7/WS9/WS10/WS11 plug themselves in by
 * mutating `validators`/`decisionService`/`computerProvider` after
 * `createCoreContext()` returns, or by registering HTTP routes through the
 * module host (`createModuleHost`, `module-host.ts`).
 */
export interface CoreContext {
  config: CoreConfig;
  clock: Clock;
  db: Db;
  closeDb: () => void;
  eventBus: EventBus;
  vault: Vault;
  deviceAuth: DeviceAuth;
  repos: CoreRepos;
  /** Wired in by WS7; `setup/validate {kind:'typesafe'}` and every gate call use this once set. */
  decisionService?: DecisionService;
  /** Wired in by WS9; computer status/start/live-view/takeover routes 501 until this is set. */
  computerProvider?: ComputerProvider;
  /** Wired in by WS10; connector catalog/connect/triggers routes 501 until this is set. */
  connectorService?: ConnectorService;
  /** Setup-wizard validators for engine/connector/remote kinds; WS3/WS10/WS11 register theirs at boot. */
  validators: Partial<Record<SetupValidatorKind, SetupValidator>>;
  /** Wired in by WS11; pairing, E2E framing, Tailscale/Cloudflare managers. */
  remote?: RemoteServices;
  /** Wired in by WS12; routine run/webhook/scheduler orchestration. */
  routineOrchestrator?: RoutineOrchestratorLike;
  /** Wired in by WS13; turn enqueue/stop/steer for Client API WebSocket. */
  mailbox?: TurnMailbox;
  /**
   * Wired in by WS13: told when a user resolves an approval card over HTTP or
   * WS (after the store and event are updated), so the waiting turn or tool
   * call continues instead of timing out.
   */
  onApprovalResolved?: (approvalId: string, resolution: "allow" | "deny") => void;
  /** Wired in by WS13 bootstrap; populated for `/api/engines` and routing. */
  availableEngines?: EngineId[];
  engineStatuses?: Partial<Record<EngineId, EngineStatus>>;
  /** The address the server listens on (set by `serve` before listening). */
  bindHost?: string;
  /** Wired by bootstrap: live computer tasks (progress, steering, cancel) for the UI. */
  computerTasks?: ComputerTasksControl;
  /** Models of each available engine, for `/api/models` (Bot profile model picker). */
  listModels?: () => Promise<Array<{ engine: EngineId; models: ModelInfo[] }>>;
}

/** Minimal WS12 surface exposed on CoreContext to avoid a core↔routines import cycle. */
export interface RoutineOrchestratorLike {
  queueRun(
    routineId: string,
    cause: RoutineRunCause,
    opts?: { dryRun?: boolean; test?: boolean },
  ): Promise<RoutineRun | { skipped: true; reason: string }>;
}

export interface CreateCoreContextOptions {
  config?: CoreConfig;
  clock?: Clock;
  vault?: Vault;
  decisionService?: DecisionService;
  computerProvider?: ComputerProvider;
  /** Skips writing NDJSON to disk (tests). */
  disableNdjson?: boolean;
}

const VAULT_DEVICE_SECRET_KEY = "core.deviceTokenSecret";

/** Boots every WS1-owned piece against one `CoreConfig`: opens the DB, ensures the data dir, wires the event bus/vault/device auth. */
export async function createCoreContext(
  options: CreateCoreContextOptions = {},
): Promise<CoreContext> {
  const config = options.config ?? loadConfig();
  const clock = options.clock ?? systemClock();

  if (config.dbPath !== ":memory:") {
    await ensureDataDirs(config);
  }

  const { db, close } = openDb({ path: config.dbPath });
  const vault = options.vault ?? new FileVault(config.vaultPath, config.vaultKeyPath);
  const ndjson = options.disableNdjson
    ? new NullNdjsonWriter()
    : new NdjsonWriter(config.logsThreadsDir);
  const eventBus = new EventBus(new EventStore(db), ndjson, clock);
  const deviceAuth = new DeviceAuth(new DevicesRepo(db), await loadOrCreateDeviceSecret(vault));

  return {
    config,
    clock,
    db,
    closeDb: close,
    eventBus,
    vault,
    deviceAuth,
    decisionService: options.decisionService,
    computerProvider: options.computerProvider,
    validators: {},
    repos: {
      bots: new BotsRepo(db),
      threads: new ThreadsRepo(db),
      messages: new MessagesRepo(db),
      chains: new ChainsRepo(db),
      turns: new TurnsRepo(db),
      approvals: new ApprovalsRepo(db),
      inputRequests: new InputRequestsRepo(db),
      rules: new RulesRepo(db),
      devices: new DevicesRepo(db),
      connections: new ConnectionsRepo(db),
      computerTasks: new ComputerTasksRepo(db),
      routines: new RoutinesRepo(db),
      routineRuns: new RoutineRunsRepo(db),
      triggerEvents: new TriggerEventsRepo(db),
      engineSessions: new EngineSessionsRepo(db),
      decisions: new DecisionsRepo(db),
      capCounters: new CapCountersRepo(db),
      settings: new SettingsRepo(db),
      setupState: new SetupStateRepo(db),
    },
  };
}

async function ensureDataDirs(config: CoreConfig): Promise<void> {
  const dirs = [
    config.openbotHome,
    config.logsThreadsDir,
    config.workspaceDir,
    config.uploadsDir,
    config.trashDir,
    config.screensDir,
    config.routinesDir,
  ];
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
}

/** Derives {@link BindHostFlags} from live state — see `config.ts` for why these aren't stored on `CoreConfig`. */
export function computeBindHostFlags(ctx: CoreContext): BindHostFlags {
  const setup = ctx.repos.setupState.get();
  const remoteEnabled = Boolean(setup.tailscale?.ok || setup.cloudflare?.ok);
  const deviceAuthConfigured = ctx.repos.devices.list().some((device) => !device.revokedAt);
  const { lanAccess } = readNetworkPrefs(ctx.config.openbotHome);
  return { remoteEnabled, deviceAuthConfigured, lanAccess };
}

async function loadOrCreateDeviceSecret(vault: Vault): Promise<Buffer> {
  const existing = await vault.get(VAULT_DEVICE_SECRET_KEY);
  if (existing) return Buffer.from(existing, "hex");
  const secret = generateDeviceSecret();
  await vault.set(VAULT_DEVICE_SECRET_KEY, secret.toString("hex"));
  return secret;
}
