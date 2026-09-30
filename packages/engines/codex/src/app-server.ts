import { EventEmitter } from "node:events";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { EngineEvent, ToolApprovalRequest, TurnHooks, TurnInput } from "@openbot/contracts";
import { resolveCliCommand } from "@openbot/engines-common";
import type {
  CodexJsonRpcNotification,
  CodexJsonRpcRequest,
  CodexJsonRpcResponse,
  McpServerStatusListResult,
  ThreadStartResult,
  TurnStartResult,
} from "./generated/protocol.js";
import { mapApprovalRequest, threadParams } from "./thread-params.js";
import {
  handleCodexNotification,
  handleCodexResponse,
  isAuthFailureNotification,
  type CodexParseState,
} from "./parse-events.js";

export interface CodexAppServerOptions {
  codexPath?: string | null;
  env?: NodeJS.ProcessEnv;
  /** Where Codex keeps its config and login: OpenBot's private home, not the owner's `~/.codex`. */
  codexHome?: string;
  /** Runs before the process starts (prepare the private home, bring the login in). */
  beforeStart?: () => Promise<void>;
  /** Runs when the process is stopped (hand a refreshed login back). */
  afterStop?: () => Promise<void>;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/** One shared `codex app-server` process for all Bots (plan §5 WS3, D-010 spike). */
export class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly notifications = new EventEmitter();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private readonly options: CodexAppServerOptions;
  /** Paths of each file-change item, so its approval names what it will touch. */
  private readonly fileChangePaths = new Map<string, string[]>();

  constructor(options: CodexAppServerOptions = {}) {
    this.options = options;
  }

  onNotification(handler: (n: CodexJsonRpcNotification) => void): () => void {
    this.notifications.on("msg", handler);
    return () => this.notifications.off("msg", handler);
  }

  async ensureStarted(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.start();
    return this.initPromise;
  }

  private async start(): Promise<void> {
    const codexPath = this.options.codexPath ?? (await resolveCliCommand("codex"));
    if (!codexPath) throw new Error("codex CLI not installed");
    await this.options.beforeStart?.();

    const { spawn } = await import("node:child_process");
    this.child = spawn(codexPath, ["app-server"], {
      env: {
        ...process.env,
        ...(this.options.codexHome ? { CODEX_HOME: this.options.codexHome } : {}),
        ...this.options.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    const rl = createInterface({ input: this.child.stdout });
    // Opt-in raw trace for diagnosing protocol drift: every line the app-server sends.
    const traceFile = process.env.OPENBOT_CODEX_TRACE_FILE;
    rl.on("line", (line) => {
      if (!line.trim()) return;
      if (traceFile) {
        try {
          appendFileSync(
            traceFile,
            `${line}
`,
          );
        } catch {
          // tracing must never affect a turn
        }
      }
      try {
        this.handleLine(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // ignore
      }
    });

    await this.send("initialize", {
      clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.sendNotification("initialized", {});
    this.initialized = true;
  }

  /**
   * Skills the owner installed, Codex bundles, or the account's plugins sync in (Google Drive,
   * templates...) are instructions the Bot never asked for: switched off. Plugin skills show up a few
   * seconds after Codex starts, so this runs before every thread and every turn, not once.
   */
  async quietSkills(cwd: string): Promise<void> {
    try {
      const listed = (await this.request("skills/list", { cwds: [cwd], forceReload: true })) as {
        data?: Array<{ skills?: Array<{ path?: string; enabled?: boolean }> }>;
      };
      for (const entry of listed.data ?? []) {
        for (const skill of entry.skills ?? []) {
          if (skill.path && skill.enabled !== false) {
            await this.request("skills/config/write", { path: skill.path, enabled: false });
          }
        }
      }
    } catch {
      // Older Codex versions have no skills API; then there is nothing to switch off.
    }
  }

  /** Skills still switched on for this folder (tests and diagnostics). */
  async enabledSkills(cwd: string): Promise<string[]> {
    const listed = (await this.request("skills/list", { cwds: [cwd], forceReload: true })) as {
      data?: Array<{ skills?: Array<{ name?: string; enabled?: boolean }> }>;
    };
    return (listed.data ?? [])
      .flatMap((entry) => entry.skills ?? [])
      .filter((skill) => skill.enabled !== false)
      .map((skill) => String(skill.name));
  }

  async threadStart(input: TurnInput): Promise<string> {
    await this.ensureStarted();
    await this.quietSkills(input.cwd);
    const result = (await this.request("thread/start", threadParams(input))) as ThreadStartResult;
    const threadId = result.thread.id;
    await this.listMcpServerStatus(threadId);
    return threadId;
  }

  /** Resumes with the same instructions, sandbox and MCP config a fresh thread would get. */
  async threadResume(threadId: string, input?: TurnInput): Promise<string> {
    await this.ensureStarted();
    const result = (await this.request("thread/resume", {
      ...(input ? threadParams(input) : {}),
      threadId,
      excludeTurns: true,
    })) as ThreadStartResult;
    return result.thread.id;
  }

  async listMcpServerStatus(threadId: string): Promise<McpServerStatusListResult> {
    return (await this.request("mcpServerStatus/list", { threadId })) as McpServerStatusListResult;
  }

  async listModels(): Promise<unknown[]> {
    const models: unknown[] = [];
    let cursor: string | undefined;
    do {
      const result = (await this.request("model/list", {
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
      })) as { data?: unknown[]; nextCursor?: string | null };
      if (Array.isArray(result.data)) models.push(...result.data);
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    return models;
  }

  async turnStart(threadId: string, text: string, cwd?: string): Promise<string> {
    if (cwd) await this.quietSkills(cwd);
    const result = (await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text }],
    })) as TurnStartResult;
    return result.turn.id;
  }

  async turnSteer(threadId: string, turnId: string, text: string): Promise<void> {
    await this.request("turn/steer", { threadId, turnId, input: [{ type: "text", text }] });
  }

  async turnInterrupt(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId });
  }

  respondToServerRequest(id: number | string, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  async handleApprovalRequest(
    notification: CodexJsonRpcNotification,
    requestApproval: (r: ToolApprovalRequest) => Promise<"allow" | "deny">,
    id: number | string,
  ): Promise<void> {
    const params = notification.params ?? {};
    const mapped = mapApprovalRequest(notification.method, params, (itemId) =>
      this.fileChangePaths.get(itemId),
    );
    if (mapped.autoAnswer !== undefined) {
      this.respondToServerRequest(id, mapped.autoAnswer);
      return;
    }
    const answer = await requestApproval({
      toolName: mapped.toolName,
      input: mapped.input,
      toolUseId: String(id),
    });
    this.respondToServerRequest(id, mapped.respond(answer === "allow"));
    const itemId = params.itemId;
    if (typeof itemId === "string") this.fileChangePaths.delete(itemId);
  }

  watchTurn(
    state: CodexParseState,
    hooks: Pick<TurnHooks, "emit" | "requestApproval">,
  ): () => void {
    return this.onNotification(async (notification) => {
      // Server requests (approvals) name their thread: answer only our own turn's.
      const owner = (notification.params as { threadId?: unknown } | undefined)?.threadId;
      const foreign =
        typeof owner === "string" && state.threadId !== undefined && owner !== state.threadId;

      if (notification.id != null && typeof notification.id === "number") {
        if (!foreign) {
          await this.handleApprovalRequest(notification, hooks.requestApproval, notification.id);
        }
        return;
      }

      if (
        notification.method === "item/commandExecution/requestApproval" ||
        notification.method === "item/fileChange/requestApproval" ||
        notification.method === "item/permissions/requestApproval"
      ) {
        const reqId = (notification as unknown as { id?: number }).id;
        if (reqId != null && !foreign) {
          await this.handleApprovalRequest(notification, hooks.requestApproval, reqId);
        }
        return;
      }

      handleCodexNotification(notification, state, hooks);
      if (isAuthFailureNotification(notification) && state.threadId && state.turnId) {
        await this.turnInterrupt(state.threadId, state.turnId);
      }
    });
  }

  private handleLine(line: Record<string, unknown>): void {
    if (line.id != null && (line.result != null || line.error != null)) {
      const id = Number(line.id);
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        if (line.error) {
          pending.reject(
            new Error(String((line.error as { message?: string }).message ?? "rpc error")),
          );
        } else {
          pending.resolve(line.result);
        }
      }
      handleCodexResponse(
        line,
        {
          turnComplete: false,
          text: "",
          usage: { inputTokens: 0, outputTokens: 0 },
          isError: false,
          authFailure: false,
        },
        { emit: () => {} },
      );
      return;
    }

    if (line.method) {
      const notification: CodexJsonRpcNotification = {
        jsonrpc: "2.0",
        method: String(line.method),
        params: line.params as Record<string, unknown>,
      };
      if (line.id != null) {
        (notification as CodexJsonRpcNotification & { id?: number }).id = Number(line.id);
      }
      this.rememberFileChange(notification);
      this.notifications.emit("msg", notification);
    }
  }

  private rememberFileChange(notification: CodexJsonRpcNotification): void {
    if (notification.method !== "item/started") return;
    const item = (
      notification.params as { item?: { type?: string; id?: string; changes?: unknown } }
    )?.item;
    if (item?.type !== "fileChange" || !item.id || !Array.isArray(item.changes)) return;
    const paths = item.changes
      .map((change) => (change as { path?: unknown }).path)
      .filter((path): path is string => typeof path === "string");
    if (paths.length > 0) this.fileChangePaths.set(item.id, paths);
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.ensureStarted();
    return this.send(method, params);
  }

  /**
   * One JSON-RPC call on the running process. `start()` uses this directly for
   * `initialize`: going through `request()` would wait on `ensureStarted()`,
   * which is waiting on `start()` — a deadlock that hung every Codex call.
   */
  private send(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload: CodexJsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(payload);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`codex rpc timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(
    payload: CodexJsonRpcRequest | CodexJsonRpcResponse | CodexJsonRpcNotification,
  ): void {
    this.child?.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  async dispose(): Promise<void> {
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
    this.initialized = false;
    this.initPromise = null;
    this.pending.clear();
    await this.options.afterStop?.();
  }
}

/** Fixture-backed app-server for golden replay tests. */
export class FixtureCodexAppServer {
  private fixtureLines: Record<string, unknown>[] = [];
  private loaded = false;
  private readonly fixturePath: string;
  private readonly loadFixture: (
    relativePath: string,
  ) => Promise<Array<{ direction?: string; raw: Record<string, unknown> }>>;

  constructor(
    fixturePath: string,
    loadFixture: (
      relativePath: string,
    ) => Promise<Array<{ direction?: string; raw: Record<string, unknown> }>>,
  ) {
    this.fixturePath = fixturePath;
    this.loadFixture = loadFixture;
  }

  onNotification(_handler: (n: CodexJsonRpcNotification) => void): () => void {
    return () => {};
  }

  async ensureStarted(): Promise<void> {
    if (this.loaded) return;
    const lines = await this.loadFixture(this.fixturePath);
    this.fixtureLines = lines
      .filter((l) => l.direction === "recv" || l.direction == null)
      .map((l) => l.raw);
    this.loaded = true;
  }

  async threadStart(_input: TurnInput): Promise<string> {
    await this.ensureStarted();
    return extractThreadId(this.fixtureLines) ?? "fixture-thread";
  }

  async threadResume(threadId: string, _input?: TurnInput): Promise<string> {
    await this.ensureStarted();
    return extractThreadId(this.fixtureLines, threadId) ?? threadId;
  }

  async listMcpServerStatus(threadId: string): Promise<McpServerStatusListResult> {
    await this.ensureStarted();
    for (const line of this.fixtureLines) {
      const params = line.params as { threadId?: string } | undefined;
      if (line.id === 3 && params?.threadId === threadId) {
        return line.result as McpServerStatusListResult;
      }
    }
    return { data: [] };
  }

  async listModels(): Promise<unknown[]> {
    await this.ensureStarted();
    for (const line of this.fixtureLines) {
      if (line.method !== "model/list") continue;
      const result = line.result as { data?: unknown[] } | undefined;
      if (Array.isArray(result?.data)) return result.data;
    }
    return [];
  }

  async turnStart(_threadId: string, _text: string, _cwd?: string): Promise<string> {
    return "fixture-turn";
  }

  async turnSteer(_threadId: string, _turnId: string, _text: string): Promise<void> {}

  async turnInterrupt(_threadId: string, _turnId: string): Promise<void> {}

  watchTurn(
    state: CodexParseState,
    hooks: {
      emit: (e: EngineEvent) => void;
      requestApproval: (r: ToolApprovalRequest) => Promise<"allow" | "deny">;
    },
  ): () => void {
    void this.ensureStarted().then(() => {
      for (const line of this.fixtureLines) {
        handleCodexResponse(line, state, hooks);
        if (line.method) {
          handleCodexNotification(
            {
              jsonrpc: "2.0",
              method: String(line.method),
              params: line.params as Record<string, unknown>,
            },
            state,
            hooks,
          );
        }
      }
      if (!state.turnComplete) {
        state.turnComplete = true;
        if (state.authFailure) state.isError = true;
      }
    });
    return () => {};
  }

  async dispose(): Promise<void> {
    this.loaded = false;
    this.fixtureLines = [];
  }
}

function extractThreadId(lines: Record<string, unknown>[], expected?: string): string | undefined {
  for (const line of lines) {
    const result = line.result as { thread?: { id?: string } } | undefined;
    const id = result?.thread?.id;
    if (!id) continue;
    if (expected && id !== expected) continue;
    return id;
  }
  return undefined;
}
