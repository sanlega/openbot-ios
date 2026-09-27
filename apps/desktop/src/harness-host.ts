import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

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
  serverEntryPath?: string;
  maxRestartDelayMs?: number;
}

const require = createRequire(import.meta.url);

export function resolveServerEntryPath(): string {
  const indexPath = require.resolve("@openbot/server");
  return join(dirname(indexPath), "main.js");
}

/** Spawns the harness in an Electron `utilityProcess` and restarts it after unexpected exits. */
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

  private spawn(): void {
    const entryPath = this.options.serverEntryPath ?? resolveServerEntryPath();

    this.child = this.options.fork.fork(entryPath, [], {
      serviceName: "openbot-harness",
      env: {
        ...process.env,
        PORT: String(this.options.port),
        OPENBOT_HOME: this.options.openbotHome,
      },
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
