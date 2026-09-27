import { spawn, type ChildProcess } from "node:child_process";
import {
  runObservationPipeline,
  stripMeta,
  type ObservationResult,
} from "@openbot/computer/observation";
import type { Action, ActResult } from "@openbot/contracts";
import { ScreenManager } from "./screen-manager.js";
import { createShellExec } from "@openbot/computer/observation";

export interface DisplaySessionOptions {
  maxScreens?: number;
  workspaceMount?: string;
}

interface SessionState {
  display: number;
  vncPort: number;
  debugPort: number;
  lastUsed: number;
  lastObservation?: ObservationResult;
  processes: ChildProcess[];
}

/**
 * Manages per-bot Xvfb displays, Chromium instances (with CDP), and observation state.
 */
export class DisplaySessionManager {
  private readonly screens = new ScreenManager(4);
  private readonly sessions = new Map<string, SessionState>();
  private readonly shell = createShellExec();

  constructor(private readonly options: DisplaySessionOptions = {}) {}

  assign(botId: string): SessionState {
    const display = this.screens.assign(botId);
    let session = this.sessions.get(botId);
    if (!session) {
      const vncPort = 5900 + display;
      const debugPort = 9220 + display;
      session = {
        display,
        vncPort,
        debugPort,
        lastUsed: Date.now(),
        processes: [],
      };
      this.ensureDisplayRunning(session);
      this.sessions.set(botId, session);
    }
    session.lastUsed = Date.now();
    return session;
  }

  async observe(botId: string, mode?: "dom" | "ax" | "ocr" | "auto"): Promise<ObservationResult> {
    const session = this.assign(botId);
    await waitForDisplay(session.display);
    const observation = await runObservationPipeline(
      {
        mode: mode ?? "auto",
        display: `:${session.display}`,
        debugPort: session.debugPort,
        cdpTimeoutMs: 30_000,
      },
      this.shell,
    );
    session.lastObservation = observation;
    return observation;
  }

  async act(botId: string, action: Action): Promise<ActResult> {
    const session = this.assign(botId);
    const env = { ...process.env, DISPLAY: `:${session.display}` };

    switch (action.op) {
      case "navigate":
        if (!action.url) return { ok: false, reason: "navigate requires url" };
        spawn(
          "chromium",
          [
            `--display=:${session.display}`,
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--remote-debugging-address=127.0.0.1",
            `--remote-debugging-port=${session.debugPort}`,
            `--user-data-dir=/tmp/openbot-chrome-${session.display}`,
            action.url,
          ],
          { detached: true, stdio: "ignore", env },
        );
        session.lastObservation = undefined;
        return { ok: true };
      case "wait":
      case "scroll":
      case "done":
        return { ok: true };
      case "type":
        if (!action.text) return { ok: false, reason: "type requires text" };
        await this.shell.run("xdotool", ["type", "--", action.text], env);
        return { ok: true };
      case "key":
        if (action.text) await this.shell.run("xdotool", ["key", action.text], env);
        return { ok: true };
      case "click":
      case "select":
        return this.click(session, action.target, env);
      default:
        return { ok: false, reason: `unsupported op: ${String(action.op)}` };
    }
  }

  publicObservation(botId: string): ReturnType<typeof stripMeta> | undefined {
    const session = this.sessions.get(botId);
    if (!session?.lastObservation) return undefined;
    return stripMeta(session.lastObservation);
  }

  private async click(
    session: SessionState,
    target: number | undefined,
    env: NodeJS.ProcessEnv,
  ): Promise<ActResult> {
    if (target === undefined) return { ok: false, reason: "click requires target" };
    const meta = session.lastObservation?._meta?.[target];
    if (!meta) {
      return { ok: false, reason: `index ${target} was not returned by the last observe()` };
    }
    if (meta.bounds) {
      const x = meta.bounds.x + Math.floor(meta.bounds.width / 2);
      const y = meta.bounds.y + Math.floor(meta.bounds.height / 2);
      await this.shell.run("xdotool", ["mousemove", String(x), String(y)], env);
      await this.shell.run("xdotool", ["click", "1"], env);
      return { ok: true };
    }
    await this.shell.run("xdotool", ["key", "Return"], env);
    return { ok: true };
  }

  private ensureDisplayRunning(session: SessionState): void {
    const displayStr = `:${session.display}`;
    const env = { ...process.env, DISPLAY: displayStr };
    const procs = [
      spawn("Xvfb", [displayStr, "-screen", "0", "1280x800x24"], {
        detached: true,
        stdio: "ignore",
        env,
      }),
      spawn("fluxbox", ["-display", displayStr], { detached: true, stdio: "ignore", env }),
      spawn(
        "x11vnc",
        [
          "-display",
          displayStr,
          "-forever",
          "-shared",
          "-rfbport",
          String(session.vncPort),
          "-nopw",
        ],
        { detached: true, stdio: "ignore", env },
      ),
      spawn(
        "chromium",
        [
          `--display=${displayStr}`,
          "--no-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--remote-debugging-address=127.0.0.1",
          `--remote-debugging-port=${session.debugPort}`,
          `--user-data-dir=/tmp/openbot-chrome-${session.display}`,
          "about:blank",
        ],
        { detached: true, stdio: "ignore", env },
      ),
    ];
    session.processes.push(...procs);
  }
}

async function waitForDisplay(display: number, timeoutMs = 15_000): Promise<void> {
  const socketPath = `/tmp/.X11-unix/X${display}`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const { access } = await import("node:fs/promises");
      await access(socketPath);
      await sleep(500);
      return;
    } catch {
      await sleep(200);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
