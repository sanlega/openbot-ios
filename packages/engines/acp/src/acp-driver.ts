import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Client,
  type ContentBlock,
  type InitializeResponse,
  type McpServer,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import type {
  EngineDescriptor,
  EngineDriver,
  EngineStatus,
  ModelInfo,
  TurnHandle,
  TurnHooks,
  TurnInput,
  TurnResult,
} from "@openbot/contracts";
import { resolveCliCommand } from "@openbot/engines-common";
import { descriptorOf, type AcpEnvironment, type AcpProfile } from "./profile.js";
import { resolveSpawnTarget } from "./spawn.js";
import { isOutside } from "./write-fence.js";
import {
  toolInputOf,
  toolNameOf,
  toolOutputOf,
  track,
  type TrackedToolCall,
} from "./tool-calls.js";

export interface AcpDriverOptions {
  /** `~/.openbot/engines`: each engine gets `<dir>/<id>` for its private config. */
  enginesDir: string;
  /** Resolves a CLI name to a path (tests inject a fake agent). */
  resolveCommand?: (name: string) => Promise<string | null>;
  /** How long `initialize`/session setup may take before the turn fails. */
  startupTimeoutMs?: number;
  /** After `session/cancel`, how long before the process is killed. */
  cancelTimeoutMs?: number;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 90_000;
const DEFAULT_CANCEL_TIMEOUT_MS = 15_000;
const STDERR_TAIL = 4_000;

/**
 * `EngineDriver` for any agent CLI that speaks the Agent Client Protocol (D-031). One agent
 * process per turn: it resumes the Bot's session (`session/resume`, else `session/load`) with
 * this turn's MCP servers, whose session token changes every turn.
 */
export class AcpDriver implements EngineDriver {
  readonly id: string;
  private readonly env: AcpEnvironment;
  private readonly resolve: (name: string) => Promise<string | null>;
  /** Models the agent itself offered in a session (`model` config option). */
  private readonly seenModels = new Map<string, ModelInfo>();
  /** System prompt last given to each session, so a changed one is sent again. */
  private readonly promptHashes = new Map<string, string>();
  private readonly running = new Set<ChildProcess>();

  constructor(
    readonly profile: AcpProfile,
    private readonly options: AcpDriverOptions,
  ) {
    this.id = profile.id;
    this.env = { stateDir: join(options.enginesDir, profile.id) };
    this.resolve = options.resolveCommand ?? resolveCliCommand;
  }

  describe(): EngineDescriptor {
    return descriptorOf(this.profile);
  }

  async command(): Promise<string | null> {
    for (const name of this.profile.binaries) {
      if (isAbsolute(name)) {
        if (existsSync(name)) return name;
        continue;
      }
      const found = await this.resolve(name);
      if (found) return found;
    }
    return null;
  }

  async detect(): Promise<EngineStatus> {
    const command = await this.command();
    if (!command) return { installed: false, login: { ok: false }, apiKey: { ok: false } };
    try {
      const found = await this.profile.detect(command, this.env);
      return { installed: true, version: found.version, login: found.login, apiKey: { ok: false } };
    } catch {
      return { installed: true, login: { ok: false }, apiKey: { ok: false } };
    }
  }

  async validateKey(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: false, reason: `${this.profile.label} signs in through its own CLI` };
  }

  async listModels(): Promise<ModelInfo[]> {
    const command = await this.command();
    const listed = command ? await this.profile.listModels(command, this.env).catch(() => []) : [];
    const ids = new Set(listed.map((m) => m.id));
    const extra = [...this.seenModels.values()].filter((m) => !ids.has(m.id));
    const all = [...listed, ...extra];
    return all.length > 0 ? all : [{ id: "default", label: `${this.profile.label} default` }];
  }

  startTurn(input: TurnInput, hooks: TurnHooks): TurnHandle {
    const turn = new AcpTurn(this, input, hooks);
    return {
      steer: async (text) => turn.steer(text),
      interrupt: async () => turn.interrupt(),
      done: turn.run(),
    };
  }

  async dispose(): Promise<void> {
    for (const child of this.running) killTree(child);
    this.running.clear();
  }

  /** @internal */
  get environment(): AcpEnvironment {
    return this.env;
  }
  /** @internal */
  get timeouts(): { startup: number; cancel: number } {
    return {
      startup: this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      cancel: this.options.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS,
    };
  }
  /** @internal */
  track(child: ChildProcess): void {
    this.running.add(child);
    child.once("exit", () => this.running.delete(child));
  }
  /** @internal */
  rememberModels(options: SessionConfigOption[] | null | undefined): void {
    const model = modelOption(options);
    if (!model) return;
    for (const option of flatOptions(model)) {
      this.seenModels.set(option.value, { id: option.value, label: option.name });
    }
  }
  /** @internal: true when this session has not seen this system prompt yet. */
  promptChanged(sessionId: string, systemPrompt: string): boolean {
    const hash = createHash("sha256").update(systemPrompt).digest("hex");
    if (this.promptHashes.get(sessionId) === hash) return false;
    this.promptHashes.set(sessionId, hash);
    return true;
  }
}

class AcpTurn {
  private child?: ChildProcess;
  private conn?: ClientSideConnection;
  private sessionId = "";
  private interrupted = false;
  private replaying = false;
  private readonly queue: string[] = [];
  private readonly calls = new Map<string, TrackedToolCall>();
  private readonly mcpNames: string[];
  private reply = "";
  private steps = 0;
  private stepLimitHit = false;
  /** A file write outside the workspace that never asked (see `checkUnaskedWrite`). */
  private unaskedWrite?: string;
  /** Tool calls the agent asked OpenBot about. */
  private readonly asked = new Set<string>();
  private stderr = "";
  private usd: number | undefined;
  private cancelTimer?: NodeJS.Timeout;

  constructor(
    private readonly driver: AcpDriver,
    private readonly input: TurnInput,
    private readonly hooks: TurnHooks,
  ) {
    this.mcpNames = input.mcpServers.map((s) => s.name);
  }

  steer(text: string): void {
    // ACP has no input while a prompt runs: the text becomes the next prompt of this turn.
    if (!this.interrupted && text.trim()) this.queue.push(text);
  }

  async interrupt(): Promise<void> {
    if (this.interrupted) return;
    this.interrupted = true;
    this.queue.length = 0;
    if (this.conn && this.sessionId) {
      await this.conn.cancel({ sessionId: this.sessionId }).catch(() => undefined);
    }
    this.cancelTimer = setTimeout(() => {
      if (this.child) killTree(this.child);
    }, this.driver.timeouts.cancel);
    this.cancelTimer.unref?.();
  }

  async run(): Promise<TurnResult> {
    const usage = { inputTokens: 0, outputTokens: 0 } as TurnResult["usage"];
    const fail = (message: string, authFailure = false): TurnResult => {
      this.hooks.emit({ type: "error", message, ...(authFailure ? { authFailure } : {}) });
      return { sessionId: this.sessionId, isError: true, errorMessage: message, usage };
    };
    try {
      const command = await this.driver.command();
      if (!command) return fail(`${this.driver.profile.label} is not installed on this computer.`);
      mkdirSync(this.driver.environment.stateDir, { recursive: true });
      const launch = await this.driver.profile.launch(this.input, this.driver.environment);
      const exited = this.start(command, launch.args, launch.env);

      const setup = this.setup(launch.model ?? this.input.model);
      const session = await raceExit(withTimeout(setup, this.driver.timeouts.startup), exited);
      if (this.interrupted) return this.stopped(usage);

      let text = this.input.text;
      if (
        launch.systemPrompt === "prompt" &&
        this.input.systemPrompt.trim() &&
        (session.fresh || this.driver.promptChanged(this.sessionId, this.input.systemPrompt))
      ) {
        if (session.fresh) this.driver.promptChanged(this.sessionId, this.input.systemPrompt);
        text = `<instructions>\n${this.input.systemPrompt}\n</instructions>\n\n${text}`;
      }

      let prompt: ContentBlock[] = [{ type: "text", text }, ...attachmentBlocks(this.input)];
      for (;;) {
        const response = await raceExit(
          this.conn!.prompt({ sessionId: this.sessionId, prompt }),
          exited,
        );
        if (response.usage) {
          usage.inputTokens += response.usage.inputTokens;
          usage.outputTokens += response.usage.outputTokens;
        }
        if (response.stopReason === "cancelled" || this.interrupted) {
          if (this.unaskedWrite) {
            return this.finish(
              fail(
                `${this.driver.profile.label} changed ${this.unaskedWrite}, outside this bot's workspace, without asking, so OpenBot stopped the turn.`,
              ),
              usage,
            );
          }
          if (this.stepLimitHit) {
            return this.finish(
              fail(`Stopped after ${this.input.limits.maxSteps} tool calls (the step limit).`),
              usage,
            );
          }
          return this.stopped(usage);
        }
        if (response.stopReason === "refusal") {
          return this.finish(fail(`${this.driver.profile.label} refused this request.`), usage);
        }
        if (response.stopReason === "max_turn_requests") {
          return this.finish(
            fail(`${this.driver.profile.label} stopped at its own limit of steps for one turn.`),
            usage,
          );
        }
        const next = this.queue.shift();
        if (next === undefined) break;
        prompt = [{ type: "text", text: next }];
      }

      const transport = this.driver.profile.replyFailure?.(this.reply);
      if (transport) return this.finish(fail(transport), usage);
      return this.finish({ sessionId: this.sessionId, isError: false, usage }, usage);
    } catch (caught) {
      if (this.interrupted) return this.stopped(usage);
      // A closed connection is usually the agent dying: say so, with its last words.
      const err = (await this.exitOf(caught)) ?? caught;
      const auth = err instanceof RequestError && err.code === -32000;
      const message = auth
        ? `${this.driver.profile.label} needs you to sign in${
            this.driver.profile.loginCommand ? `: run \`${this.driver.profile.loginCommand}\`` : ""
          }.`
        : describeError(err, this.driver.profile.label, this.stderr);
      return this.finish(fail(message, auth), usage);
    } finally {
      await this.close();
    }
  }

  private async exitOf(err: unknown): Promise<AgentExit | undefined> {
    if (err instanceof AgentExit) return err;
    const child = this.child;
    if (!child || err instanceof TimeoutError) return undefined;
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 500);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
    }
    if (child.exitCode === null && child.signalCode === null) return undefined;
    return new AgentExit(child.exitCode, child.signalCode, this.stderr.trim());
  }

  private start(command: string, args: string[], env: Record<string, string>): Promise<never> {
    const target = resolveSpawnTarget(command);
    const child = spawn(target.command, [...target.prefixArgs, ...args], {
      cwd: this.input.cwd,
      env: { ...process.env, ...target.env, ...this.input.auth.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: target.shell,
      windowsHide: true,
    });
    this.child = child;
    this.driver.track(child);
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-STDERR_TAIL);
    });
    const client: Client = {
      requestPermission: (params) => this.onPermission(params),
      sessionUpdate: (params) => this.onUpdate(params),
    };
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
    );
    this.conn = new ClientSideConnection(() => client, stream);
    return new Promise<never>((_, reject) => {
      child.once("error", (err) => reject(err));
      child.once("exit", (code, signal) => reject(new AgentExit(code, signal, this.stderr.trim())));
    });
  }

  private async setup(model: string): Promise<{ init: InitializeResponse; fresh: boolean }> {
    const conn = this.conn!;
    const init = await conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      // No `fs`/`terminal`: the agent uses its own tools, like Claude Code and Codex do.
      clientCapabilities: {},
      clientInfo: { name: "openbot", version: "0.1" },
    });
    const methodId = this.driver.profile.authMethodId;
    if (methodId && init.authMethods?.some((m) => m.id === methodId)) {
      await conn.authenticate({ methodId });
    }
    const caps = init.agentCapabilities ?? {};
    const mcpServers = this.input.mcpServers.map((s): McpServer => ({
      name: s.name,
      command: s.command,
      args: s.args ?? [],
      env: Object.entries(s.env ?? {}).map(([name, value]) => ({ name, value })),
    }));
    const dirs =
      caps.sessionCapabilities?.additionalDirectories && this.input.addDirs.length > 0
        ? { additionalDirectories: this.input.addDirs }
        : {};
    const base = { cwd: this.input.cwd, mcpServers, ...dirs };

    let configOptions: SessionConfigOption[] | null | undefined;
    let fresh = true;
    const previous = this.input.sessionId;
    if (previous) {
      try {
        if (caps.sessionCapabilities?.resume) {
          const resumed = await conn.resumeSession({ ...base, sessionId: previous });
          configOptions = resumed.configOptions;
          this.sessionId = previous;
          fresh = false;
        } else if (caps.loadSession) {
          // `session/load` replays the whole conversation as updates: they are history, not news.
          this.replaying = true;
          const loaded = await conn.loadSession({ ...base, sessionId: previous });
          configOptions = loaded.configOptions;
          this.sessionId = previous;
          fresh = false;
        }
      } catch {
        // The agent lost that session (deleted, other machine): start a new one.
      } finally {
        this.replaying = false;
      }
    }
    if (fresh) {
      const created = await conn.newSession(base);
      this.sessionId = created.sessionId;
      configOptions = created.configOptions;
    }
    this.hooks.emit({ type: "session_started", sessionId: this.sessionId });
    this.driver.rememberModels(configOptions);

    const option = modelOption(configOptions);
    if (
      option &&
      model &&
      model !== "default" &&
      model !== "auto" &&
      option.currentValue !== model
    ) {
      if (flatOptions(option).some((o) => o.value === model)) {
        await conn.setSessionConfigOption({
          sessionId: this.sessionId,
          configId: option.id,
          value: model,
        });
      }
    }
    return { init, fresh };
  }

  private async onUpdate(params: SessionNotification): Promise<void> {
    if (this.replaying || params.sessionId !== this.sessionId) return;
    const update = params.update;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (update.content.type === "text" && update.content.text) {
          this.reply += update.content.text;
          this.hooks.emit({ type: "text_delta", text: update.content.text });
        }
        return;
      case "tool_call":
      case "tool_call_update": {
        const call = track(this.calls, update);
        const status = update.status;
        if (status === "in_progress" || status === "completed" || status === "failed") {
          this.startCall(call);
          this.checkUnaskedWrite(call);
        }
        if ((status === "completed" || status === "failed") && !call.finished) {
          call.finished = true;
          this.hooks.emit({
            type: "tool_completed",
            toolUseId: call.id,
            output: toolOutputOf(update),
            isError: status === "failed",
          });
        }
        return;
      }
      case "usage_update":
        if (update.cost && update.cost.currency.toUpperCase() === "USD")
          this.usd = update.cost.amount;
        return;
      default:
        return;
    }
  }

  /**
   * Backstop for agents whose file tool does not ask (Cursor writes without a permission request;
   * its deny rules only cover folders that existed at launch): a write outside the workspace that
   * OpenBot never approved stops the turn, unless the bot has Full permissions.
   */
  private checkUnaskedWrite(call: TrackedToolCall): void {
    if (this.input.permission === "full" || this.asked.has(call.id) || this.interrupted) return;
    if (call.kind !== "edit" && call.kind !== "delete" && call.kind !== "move") return;
    const input = toolInputOf(call);
    const paths = [
      ...call.locations,
      ...(typeof input.file_path === "string" ? [input.file_path] : []),
    ];
    const allowed = [this.input.cwd, ...this.input.addDirs];
    const outside = paths.find((p) => isOutside(p, allowed, this.input.cwd));
    if (!outside) return;
    this.unaskedWrite = outside;
    void this.interrupt();
  }

  private startCall(call: TrackedToolCall): void {
    if (call.started) return;
    call.started = true;
    this.steps += 1;
    this.hooks.emit({
      type: "tool_started",
      toolName: toolNameOf(call, this.mcpNames),
      input: toolInputOf(call),
      toolUseId: call.id,
    });
    if (this.steps > this.input.limits.maxSteps && !this.interrupted) {
      this.stepLimitHit = true;
      void this.interrupt();
    }
  }

  private async onPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    if (this.interrupted) return { outcome: { outcome: "cancelled" } };
    const call = track(this.calls, params.toolCall);
    this.asked.add(call.id);
    const name = toolNameOf(call, this.mcpNames);
    // The agent enforces nothing of OpenBot's deny list, so refuse those tools here.
    const denied = this.input.denyTools.some((p) => name === p || name.startsWith(`${p}__`));
    const decision = denied
      ? ("deny" as const)
      : await this.hooks
          .requestApproval({
            toolName: name,
            input: toolInputOf(call),
            toolUseId: call.id,
          })
          .catch(() => "deny" as const);
    if (this.interrupted) return { outcome: { outcome: "cancelled" } };
    // Never an "always" option: a grant must not outlive this one call.
    const option = pickOption(params.options, decision === "allow" ? "allow_once" : "reject_once");
    if (!option) return { outcome: { outcome: "cancelled" } };
    return { outcome: { outcome: "selected", optionId: option.optionId } };
  }

  private stopped(usage: TurnResult["usage"]): TurnResult {
    return this.finish(
      { sessionId: this.sessionId, isError: true, errorMessage: "interrupted", usage },
      usage,
    );
  }

  private finish(result: TurnResult, usage: TurnResult["usage"]): TurnResult {
    if (this.usd !== undefined) usage.usd = this.usd;
    if (usage.inputTokens || usage.outputTokens || usage.usd !== undefined) {
      this.hooks.emit({ type: "usage", ...usage });
    }
    return { ...result, usage };
  }

  /** The turn is over only once the agent process (and its MCP servers) is gone. */
  private async close(): Promise<void> {
    if (this.cancelTimer) clearTimeout(this.cancelTimer);
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.stdin?.end();
    const timer = setTimeout(() => killTree(child), 1_000);
    const giveUp = new Promise<void>((resolve) => setTimeout(resolve, 5_000).unref?.());
    await Promise.race([exited, giveUp]);
    clearTimeout(timer);
  }
}

class AgentExit extends Error {
  constructor(
    readonly code: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderr: string,
  ) {
    super(`agent exited (${signal ?? code})`);
  }
}

function describeError(err: unknown, label: string, stderr: string): string {
  const tail = lastLines(stderr, 3);
  if (err instanceof AgentExit) {
    return `${label} stopped unexpectedly (exit ${err.signal ?? err.code})${tail ? `: ${tail}` : "."}`;
  }
  if (err instanceof TimeoutError) {
    return `${label} did not start in time${tail ? `: ${tail}` : "."}`;
  }
  if (err instanceof RequestError) return `${label}: ${err.message}`;
  const message = err instanceof Error ? err.message : String(err);
  if (/ENOENT/.test(message)) return `${label} could not be started (${message}).`;
  return `${label}: ${message}`;
}

function lastLines(text: string, n: number): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .join(" ")
    .replace(/(sk-|Bearer\s+)[A-Za-z0-9._-]{8,}/g, "$1…")
    .slice(0, 400);
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(`timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The agent dying must fail whatever request was waiting on it. */
function raceExit<T>(promise: Promise<T>, exited: Promise<never>): Promise<T> {
  return Promise.race([promise, exited]);
}

function pickOption(options: PermissionOption[], kind: string): PermissionOption | undefined {
  const exact = options.find((o) => o.kind === kind);
  if (exact) return exact;
  // An agent that offers only "always" for allowing still gets a refusal-safe answer.
  if (kind === "reject_once") return options.find((o) => o.kind === "reject_always");
  return undefined;
}

type SelectOption = Extract<SessionConfigOption, { type: "select" }>;

function modelOption(options: SessionConfigOption[] | null | undefined): SelectOption | undefined {
  return (options ?? []).find(
    (o): o is SelectOption => o.type === "select" && (o.category === "model" || o.id === "model"),
  );
}

function flatOptions(option: SelectOption): Array<{ value: string; name: string }> {
  const out: Array<{ value: string; name: string }> = [];
  for (const entry of option.options) {
    if ("group" in entry) out.push(...entry.options);
    else out.push(entry);
  }
  return out;
}

function attachmentBlocks(input: TurnInput): ContentBlock[] {
  return input.attachments.map((path) => ({
    type: "resource_link",
    uri: pathToFileURL(path).href,
    name: basename(path),
  }));
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).on("error", () => child.kill());
    return;
  }
  child.kill("SIGTERM");
}
