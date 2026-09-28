import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type HarnessHostEvents = {
  ready: [];
  exit: [code: number | null];
};

export interface UtilityProcessLike {
  on(event: "spawn" | "exit", listener: (...args: unknown[]) => void): void;
  kill(): void;
  pid?: number;
}

export interface UtilityProcessFactory {
  fork(
    modulePath: string,
    args?: string[],
    options?: { serviceName?: string; env?: Record<string, string | undefined> },
  ): UtilityProcessLike;
}

export interface HarnessHostOptions {
  port: number;
  openbotHome: string;
  fork: UtilityProcessFactory;
  /** When set, fork this entry directly (packaged harness bundle). */
  harnessEntry?: string;
  pwaStaticRoot?: string;
  maxRestartDelayMs?: number;
}

const require = createRequire(import.meta.url);
const desktopDist = dirname(fileURLToPath(import.meta.url));

export function resolveServerMainPath(): string {
  const indexPath = require.resolve("@openbot/server");
  return join(dirname(indexPath), "main.js");
}

export function resolvePackagedHarnessEntry(): string {
  return join(desktopDist, "harness.mjs");
}

export function resolvePwaStaticRoot(): string {
  const pwaIndex = require.resolve("@openbot/pwa");
  return join(dirname(dirname(pwaIndex)), "static");
}

/** Dev/test: spawn compiled server entry with system Node. */
export function resolveDevHarnessLaunch(cliArgs: string[] = []): {
  program: string;
  args: string[];
} {
  return { program: resolveServerMainPath(), args: cliArgs };
}

export function createNodeForkFactory(): UtilityProcessFactory {
  return {
    fork(program, args, options) {
      const nodeBin = process.env.npm_node_execpath ?? "node";
      const child = spawn(nodeBin, [program, ...(args ?? [])], {
        env: options?.env as NodeJS.ProcessEnv,
        stdio: "inherit",
      });
      return wrapChildProcess(child);
    },
  };
}

export function createUtilityProcessFactory(utilityProcess: {
  fork(
    modulePath: string,
    args?: string[],
    options?: { serviceName?: string; env?: Record<string, string | undefined> },
  ): UtilityProcessLike;
}): UtilityProcessFactory {
  return {
    fork(modulePath, args, options) {
      const child = utilityProcess.fork(modulePath, args, {
        serviceName: options?.serviceName,
        env: options?.env,
      });
      return {
        on(event, listener) {
          child.on(event, listener);
        },
        kill: () => {
          child.kill();
        },
        pid: child.pid,
      };
    },
  };
}

function wrapChildProcess(child: ReturnType<typeof spawn>): UtilityProcessLike {
  return {
    on(event, listener) {
      if (event === "spawn") {
        if (child.pid !== undefined) queueMicrotask(() => listener());
        else child.on("spawn", () => listener());
      }
      if (event === "exit") child.on("exit", (code) => listener(code));
    },
    kill: () => {
      child.kill("SIGTERM");
    },
    pid: child.pid,
  };
}

/** Spawns the harness and restarts it after unexpected exits. */
export class HarnessHost extends EventEmitter<HarnessHostEvents> {
  private child?: UtilityProcessLike;
  private intentionalStop = false;
  private restartAttempts = 0;
  private restartTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: HarnessHostOptions) {
    super();
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): void {
    this.intentionalStop = false;
    this.spawn();
  }

  stop(): void {
    this.intentionalStop = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.child?.kill();
    this.child = undefined;
  }

  private harnessEnv(): Record<string, string | undefined> {
    return {
      ...process.env,
      PORT: String(this.options.port),
      OPENBOT_HOME: this.options.openbotHome,
      // Engines launch OpenBot's MCP scripts with this binary (as Node).
      OPENBOT_NODE_BIN: process.execPath,
      OPENBOT_PWA_STATIC_ROOT: this.options.pwaStaticRoot ?? resolvePwaStaticRoot(),
    };
  }

  private spawn(): void {
    const entry = this.options.harnessEntry ?? resolveDevHarnessLaunch(["serve"]).program;
    const args = ["serve"];

    this.child = this.options.fork.fork(entry, args, {
      serviceName: "openbot-harness",
      env: this.harnessEnv(),
    });

    this.child.on("spawn", () => {
      this.restartAttempts = 0;
      this.emit("ready");
    });

    this.child.on("exit", (code: unknown) => {
      const exitCode = typeof code === "number" ? code : null;
      this.emit("exit", exitCode);
      this.child = undefined;
      if (!this.intentionalStop) this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    const maxDelay = this.options.maxRestartDelayMs ?? 30_000;
    const delay = Math.min(1000 * 2 ** this.restartAttempts, maxDelay);
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => this.spawn(), delay);
  }
}
