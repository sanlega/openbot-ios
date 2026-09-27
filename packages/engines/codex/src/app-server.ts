import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { EngineEvent, ToolApprovalRequest, TurnHooks, TurnInput } from "@openbot/contracts";
import { resolveCliCommand } from "@openbot/engines-common";
import type {
  CodexApprovalDecision,
  CodexJsonRpcNotification,
  CodexJsonRpcRequest,
  CodexJsonRpcResponse,
  McpServerStatusListResult,
  ThreadStartResult,
  TurnStartResult,
} from "./generated/protocol.js";
import {
  handleCodexNotification,
  handleCodexResponse,
  isAuthFailureNotification,
  type CodexParseState,
} from "./parse-events.js";

export interface CodexAppServerOptions {
  codexPath?: string | null;
  env?: NodeJS.ProcessEnv;
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

    const { spawn } = await import("node:child_process");
    this.child = spawn(codexPath, ["app-server"], {
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        this.handleLine(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // ignore
      }
    });

    await this.request("initialize", {
      clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.sendNotification("initialized", {});
    this.initialized = true;
  }

  async threadStart(input: TurnInput): Promise<string> {
    await this.ensureStarted();
    const config = buildThreadConfig(input);
    const result = (await this.request("thread/start", {
      cwd: input.cwd,
      model: input.model,
      config,
    })) as ThreadStartResult;
    const threadId = result.thread.id;
    await this.listMcpServerStatus(threadId);
    return threadId;
  }

  async threadResume(threadId: string): Promise<string> {
    await this.ensureStarted();
    const result = (await this.request("thread/resume", {
      threadId,
      excludeTurns: true,
    })) as ThreadStartResult;
    return result.thread.id;
  }

  async listMcpServerStatus(threadId: string): Promise<McpServerStatusListResult> {
    return (await this.request("mcpServerStatus/list", { threadId })) as McpServerStatusListResult;
  }

  async turnStart(threadId: string, text: string): Promise<string> {
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
    const summary = notification.method;
    const decision = await requestApproval({
      toolName: summary,
      input: params,
      toolUseId: String(id),
    });
    const mapped: CodexApprovalDecision = decision === "allow" ? "accept" : "decline";
    this.respondToServerRequest(id, { decision: mapped });
  }

  watchTurn(
    state: CodexParseState,
    hooks: Pick<TurnHooks, "emit" | "requestApproval">,
  ): () => void {
    return this.onNotification(async (notification) => {
      if (notification.id != null && typeof notification.id === "number") {
        await this.handleApprovalRequest(notification, hooks.requestApproval, notification.id);
        return;
      }

      if (
        notification.method === "item/commandExecution/requestApproval" ||
        notification.method === "item/fileChange/requestApproval" ||
        notification.method === "item/permissions/requestApproval"
      ) {
        const reqId = (notification as unknown as { id?: number }).id;
        if (reqId != null) {
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
      this.notifications.emit("msg", notification);
    }
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.ensureStarted();
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
  }
}

function buildThreadConfig(input: TurnInput): Record<string, unknown> {
  if (input.mcpServers.length === 0) return {};
  const mcp_servers: Record<string, unknown> = {};
  for (const server of input.mcpServers) {
    mcp_servers[server.name] = {
      command: server.command,
      args: server.args ?? [],
      env: server.env ?? {},
    };
  }
  return { mcp_servers };
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

  async threadResume(threadId: string): Promise<string> {
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

  async turnStart(_threadId: string, _text: string): Promise<string> {
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
