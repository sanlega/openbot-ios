import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { writeFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServerSpec, TurnInput } from "@openbot/contracts";
import { buildTurnEnv, resolveCliCommand, runCommand } from "@openbot/engines-common";

export interface ClaudeProcessHandle {
  writeUserMessage(text: string): void;
  interrupt(): void;
  close(): Promise<void>;
  onLine(handler: (line: Record<string, unknown>) => void): () => void;
}

export interface ClaudeTransport {
  spawnSession(
    input: TurnInput,
    options: { resumeSessionId?: string },
  ): Promise<ClaudeProcessHandle>;
}

export interface SubprocessClaudeTransportOptions {
  claudePath?: string | null;
}

export class SubprocessClaudeTransport implements ClaudeTransport {
  private readonly claudePathPromise: Promise<string | null>;

  constructor(options: SubprocessClaudeTransportOptions = {}) {
    this.claudePathPromise =
      options.claudePath != null
        ? Promise.resolve(options.claudePath)
        : resolveCliCommand("claude");
  }

  async spawnSession(
    input: TurnInput,
    options: { resumeSessionId?: string },
  ): Promise<ClaudeProcessHandle> {
    const claudePath = await this.claudePathPromise;
    if (!claudePath) {
      throw new Error("claude CLI not installed");
    }

    const mcpConfigPath = await writeMcpConfig(input.mcpServers);
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--replay-user-messages",
      "--model",
      input.model,
      "--append-system-prompt",
      input.systemPrompt,
      "--max-turns",
      String(input.limits.maxSteps),
    ];

    if (input.limits.maxUsd != null) {
      args.push("--max-budget-usd", String(input.limits.maxUsd));
    }
    for (const dir of input.addDirs) {
      args.push("--add-dir", dir);
    }
    if (input.allowTools.length > 0) {
      args.push("--allowedTools", input.allowTools.join(","));
    }
    if (input.denyTools.length > 0) {
      args.push("--disallowedTools", input.denyTools.join(","));
    }
    if (mcpConfigPath) {
      args.push("--mcp-config", mcpConfigPath, "--strict-mcp-config");
      args.push("--permission-prompt-tool", "mcp__openbot__permission_prompt");
    }
    if (options.resumeSessionId) {
      args.push("--resume", options.resumeSessionId);
    }

    const env = buildTurnEnv("claude", input.auth);
    const { spawn } = await import("node:child_process");
    const child = spawn(claudePath, args, {
      cwd: input.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    const emitter = new EventEmitter();
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        emitter.emit("line", JSON.parse(line) as Record<string, unknown>);
      } catch {
        // ignore malformed lines
      }
    });

    return {
      writeUserMessage(text: string) {
        const msg = {
          type: "user",
          message: { role: "user", content: [{ type: "text", text }] },
        };
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      },
      interrupt() {
        child.kill("SIGINT");
      },
      async close() {
        child.stdin.end();
        await new Promise<void>((resolve) => {
          child.once("close", () => resolve());
          setTimeout(() => {
            if (!child.killed) child.kill();
            resolve();
          }, 2_000);
        });
      },
      onLine(handler) {
        emitter.on("line", handler);
        return () => emitter.off("line", handler);
      },
    };
  }
}

/** Fixture-backed transport for golden replay tests (no real CLI). */
export class FixtureClaudeTransport implements ClaudeTransport {
  constructor(
    private readonly fixturePath: string,
    private readonly loadFixture: (
      relativePath: string,
    ) => Promise<Array<{ direction?: string; raw: Record<string, unknown> }>>,
  ) {}

  async spawnSession(
    _input: TurnInput,
    _options: { resumeSessionId?: string },
  ): Promise<ClaudeProcessHandle> {
    const lines = await this.loadFixture(this.fixturePath);
    const recv = lines
      .filter((l) => l.direction === "recv" || l.direction == null)
      .map((l) => l.raw);
    const emitter = new EventEmitter();
    let index = 0;

    const pump = () => {
      if (index >= recv.length) return;
      const line = recv[index];
      index += 1;
      if (line) emitter.emit("line", line);
    };

    return {
      writeUserMessage(_text: string) {
        // Each user message advances through fixture recv lines until next result.
        while (index < recv.length) {
          const line = recv[index];
          index += 1;
          if (line) emitter.emit("line", line);
          if (line?.type === "result") break;
        }
      },
      interrupt() {
        // no-op for fixtures
      },
      async close() {
        // drain remaining lines
        while (index < recv.length) {
          const line = recv[index];
          index += 1;
          if (line) emitter.emit("line", line);
        }
      },
      onLine(handler) {
        emitter.on("line", handler);
        // emit init immediately on attach
        pump();
        return () => emitter.off("line", handler);
      },
    };
  }
}

async function writeMcpConfig(servers: McpServerSpec[]): Promise<string | null> {
  if (servers.length === 0) return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), "openbot-claude-mcp-"));
  const payload = {
    mcpServers: Object.fromEntries(
      servers.map((s) => [s.name, { command: s.command, args: s.args ?? [], env: s.env ?? {} }]),
    ),
  };
  const file = path.join(dir, "mcp.json");
  await writeFile(file, JSON.stringify(payload), "utf8");
  return file;
}

export async function claudeInstalled(): Promise<boolean> {
  return (await resolveCliCommand("claude")) != null;
}

export { runCommand };
