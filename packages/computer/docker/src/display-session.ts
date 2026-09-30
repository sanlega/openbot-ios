import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import {
  runObservationPipeline,
  stripMeta,
  withCdp,
  type ObservationMode,
  type ObservationResult,
  type ShellExec,
} from "@openbot/computer/observation";
import type { Action, ActResult } from "@openbot/contracts";
import { ScreenManager } from "./screen-manager.js";
import { createShellExec } from "@openbot/computer/observation";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
// The daemon runs in the Linux container: its paths are POSIX paths.
import { posix } from "node:path";
import { SharedCookieJar, type BrowserCookie, type CookieAccess } from "./cookie-jar.js";

export interface DisplaySessionOptions {
  maxScreens?: number;
  workspaceMount?: string;
  onEvict?: (display: number) => void;
  /** Runs xdotool and friends (injected in tests). */
  shell?: ShellExec;
  /**
   * Loads a URL in the browser's current tab over CDP and closes the others.
   * Resolves false when the browser isn't reachable (then a new one is launched).
   */
  navigateTab?: (debugPort: number, url: string) => Promise<boolean>;
  /** Clicks and types in the page over CDP (stubbed in tests). */
  pageInput?: PageInput;
  /** Starts Xvfb, the window manager, VNC and Chromium for a display (stubbed in tests). */
  startDisplay?: (display: number, debugPort: number, vncPort: number) => Promise<void>;
  /**
   * Where each screen's browser profile lives. On the container's browser volume, so sign-ins
   * and browser state survive a restart (D-032); `/tmp` when not set.
   */
  profileRoot?: string;
  /** Downloads go here (the bots' shared workspace, mounted in the container). */
  downloadDir?: string;
  /** Reads and writes each browser's cookies; with it, every screen shares one set of sign-ins. */
  cookies?: CookieAccess;
  /** Where the shared sign-ins are saved. */
  cookieFile?: string;
  /** Reads the page (stubbed in tests). */
  observePage?: (
    display: number,
    debugPort: number,
    mode: ObservationMode,
  ) => Promise<ObservationResult>;
}

/** Drives the page itself, in viewport coordinates, so window position doesn't matter. */
export interface PageInput {
  /** Resolves false when the browser can't be reached. */
  click(debugPort: number, x: number, y: number): Promise<boolean>;
  /** Clicks the field, then replaces its text. Resolves false when unreachable. */
  typeInto(debugPort: number, x: number, y: number, text: string): Promise<boolean>;
  /** Presses a key in the page. Resolves false when unreachable. */
  press(debugPort: number, key: string): Promise<boolean>;
}

const cdpPageInput: PageInput = {
  async click(debugPort, x, y) {
    try {
      await withCdp(debugPort, (client) => client.clickAt(x, y), 3_000);
      return true;
    } catch {
      return false;
    }
  },
  async press(debugPort, key) {
    try {
      await withCdp(debugPort, (client) => client.pressKey(key), 3_000);
      return true;
    } catch {
      return false;
    }
  },
  async typeInto(debugPort, x, y, text) {
    try {
      await withCdp(
        debugPort,
        async (client) => {
          await client.clickAt(x, y);
          await client.replaceFocusedText(text);
        },
        3_000,
      );
      return true;
    } catch {
      return false;
    }
  },
};

async function navigateTabOverCdp(debugPort: number, url: string): Promise<boolean> {
  try {
    await withCdp(
      debugPort,
      async (client) => {
        await client.navigate(url);
        await client.closeOtherTabs();
      },
      3_000,
    );
    return true;
  } catch {
    return false;
  }
}

interface SessionState {
  display: number;
  vncPort: number;
  debugPort: number;
  lastUsed: number;
  lastObservation?: ObservationResult;
  processes: ChildProcess[];
  ready: Promise<void>;
}

/**
 * Manages per-bot Xvfb displays, Chromium instances (with CDP), and observation state.
 */
export class DisplaySessionManager {
  private readonly screens: ScreenManager;
  private readonly sessions = new Map<string, SessionState>();
  private readonly shell: ShellExec;
  private readonly navigateTab: (debugPort: number, url: string) => Promise<boolean>;
  private readonly pageInput: PageInput;
  private readonly jar: SharedCookieJar | undefined;

  constructor(private readonly options: DisplaySessionOptions = {}) {
    this.screens = new ScreenManager(options.maxScreens ?? 4);
    this.shell = options.shell ?? createShellExec();
    this.navigateTab = options.navigateTab ?? navigateTabOverCdp;
    this.pageInput = options.pageInput ?? cdpPageInput;
    this.jar = options.cookies
      ? new SharedCookieJar(options.cookies, options.cookieFile)
      : undefined;
  }

  /** The DevTools port of a bot's browser, if it has a screen. */
  debugPort(botId: string): number | undefined {
    return this.sessions.get(botId)?.debugPort;
  }

  /** The profile folder of a screen's browser. */
  profileDir(display: number): string {
    return this.options.profileRoot
      ? posix.join(this.options.profileRoot, `screen-${display}`)
      : `/tmp/openbot-chrome-${display}`;
  }

  /** Before a bot looks or acts: its browser gets every sign-in (or sign-out) made on any screen. */
  private async shareSignIns(session: SessionState): Promise<void> {
    if (!this.jar) return;
    const ports = [...this.sessions.values()].map((s) => s.debugPort);
    await this.jar.sync(session.debugPort, ports).catch(() => undefined);
  }

  /** Chromium's own preferences for a screen's profile: downloads land in the shared workspace. */
  private prepareProfile(display: number): void {
    const dir = this.profileDir(display);
    try {
      mkdirSync(posix.join(dir, "Default"), { recursive: true });
      if (!this.options.downloadDir) return;
      mkdirSync(this.options.downloadDir, { recursive: true });
      const file = posix.join(dir, "Default", "Preferences");
      let prefs: Record<string, unknown> = {};
      try {
        prefs = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      } catch {
        // First start of this profile.
      }
      const download = (prefs.download ?? {}) as Record<string, unknown>;
      prefs.download = {
        ...download,
        default_directory: this.options.downloadDir,
        prompt_for_download: false,
        directory_upgrade: true,
      };
      const savefile = (prefs.savefile ?? {}) as Record<string, unknown>;
      prefs.savefile = { ...savefile, default_directory: this.options.downloadDir };
      writeFileSync(file, JSON.stringify(prefs));
    } catch {
      // The browser still starts with its defaults.
    }
  }

  assign(botId: string): SessionState {
    const display = this.screens.assign(botId);
    for (const [id, old] of this.sessions) {
      if ((id !== botId && old.display === display) || (id === botId && old.display !== display)) {
        for (const child of old.processes) {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              // A desktop process may already have exited.
            }
          }
        }
        this.sessions.delete(id);
        this.jar?.forget(old.debugPort);
        this.options.onEvict?.(old.display);
      }
    }
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
        ready: Promise.resolve(),
      };
      this.sessions.set(botId, session);
      session.ready = this.options.startDisplay
        ? this.options.startDisplay(session.display, session.debugPort, session.vncPort)
        : this.ensureDisplayRunning(session);
      // A display that failed to start must not stay "assigned but broken": drop it so the next
      // request starts a fresh one instead of failing on the same rejected promise forever.
      const failed = session;
      failed.ready.catch(() => this.discard(botId, failed));
    }
    session.lastUsed = Date.now();
    return session;
  }

  async observe(botId: string, mode?: "dom" | "ax" | "ocr" | "auto"): Promise<ObservationResult> {
    const session = this.assign(botId);
    await session.ready;
    await this.shareSignIns(session);
    const observation = this.options.observePage
      ? await this.options.observePage(session.display, session.debugPort, mode ?? "auto")
      : await runObservationPipeline(
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
    await session.ready;
    await this.shareSignIns(session);
    const env = { ...process.env, DISPLAY: `:${session.display}` };

    switch (action.op) {
      case "navigate":
        if (!action.url) return { ok: false, reason: "navigate requires url" };
        session.lastObservation = undefined;
        // Same tab over CDP: launching chromium again would open a new tab, and
        // OpenBot could end up reading a tab that isn't the one on screen.
        if (await this.navigateTab(session.debugPort, action.url)) return { ok: true };
        spawn(
          "chromium",
          [
            `--display=:${session.display}`,
            "--no-sandbox",
            // Hides the "unsupported command-line flag" bar in the live view.
            "--test-type",
            "--no-first-run",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--start-maximized",
            "--remote-debugging-address=127.0.0.1",
            `--remote-debugging-port=${session.debugPort}`,
            `--user-data-dir=${this.profileDir(session.display)}`,
            action.url,
          ],
          { detached: true, stdio: "ignore", env },
        );
        session.lastObservation = undefined;
        return { ok: true };
      case "scroll":
        // Mouse wheel: button 4 scrolls up, 5 down.
        await this.shell.run(
          "xdotool",
          ["click", "--repeat", "5", action.text === "up" ? "4" : "5"],
          env,
        );
        session.lastObservation = undefined;
        return { ok: true };
      case "wait":
      case "done":
        return { ok: true };
      case "type": {
        if (!action.text) return { ok: false, reason: "type requires text" };
        if (action.target !== undefined) {
          const meta = session.lastObservation?._meta?.[action.target];
          if (!meta) {
            return {
              ok: false,
              reason: `index ${action.target} was not returned by the last observe()`,
            };
          }
          // Focus that field and replace its text; typing with xdotool alone
          // goes wherever focus happens to be.
          if (meta.bounds) {
            const { x, y } = center(meta.bounds);
            if (await this.pageInput.typeInto(session.debugPort, x, y, action.text)) {
              session.lastObservation = undefined;
              return { ok: true };
            }
          }
        }
        await this.shell.run("xdotool", ["type", "--delay", "20", "--", action.text], env);
        session.lastObservation = undefined;
        return { ok: true };
      }
      case "key":
        if (!action.text) return { ok: true };
        session.lastObservation = undefined;
        // In the page over CDP: X focus may sit on the address bar, not the page.
        if (await this.pageInput.press(session.debugPort, action.text)) return { ok: true };
        await this.shell.run("xdotool", ["key", xdotoolKey(action.text)], env);
        return { ok: true };
      case "click":
      case "select":
        return this.click(session, action.target, env);
      default:
        return { ok: false, reason: `unsupported op: ${String(action.op)}` };
    }
  }

  async ensureReady(botId: string): Promise<SessionState> {
    const session = this.assign(botId);
    await session.ready;
    await waitForPort(session.vncPort);
    return session;
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
      // Bounds are viewport coordinates: click inside the page over CDP.
      const { x, y } = center(meta.bounds);
      session.lastObservation = undefined;
      if (await this.pageInput.click(session.debugPort, x, y)) return { ok: true };
      await this.shell.run("xdotool", ["mousemove", String(x), String(y)], env);
      await this.shell.run("xdotool", ["click", "1"], env);
      return { ok: true };
    }
    await this.shell.run("xdotool", ["key", "Return"], env);
    return { ok: true };
  }

  private discard(botId: string, session: SessionState): void {
    if (this.sessions.get(botId) !== session) return;
    for (const child of session.processes) {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
      }
    }
    this.sessions.delete(botId);
  }

  private async ensureDisplayRunning(session: SessionState): Promise<void> {
    const displayStr = `:${session.display}`;
    const env = { ...process.env, DISPLAY: displayStr };
    // A container that was stopped or crashed keeps its old X lock and browser profile lock,
    // which make Xvfb and Chromium refuse to start (and VNC never comes up).
    await removeStaleDesktopLocks(session.display, this.profileDir(session.display));
    this.prepareProfile(session.display);
    // A new browser on this screen: it has to receive the shared sign-ins from scratch.
    this.jar?.forget(session.debugPort);
    session.processes.push(
      spawn("Xvfb", [displayStr, "-screen", "0", "1600x1000x24"], {
        detached: true,
        stdio: "ignore",
        env,
      }),
    );
    await waitForDisplay(session.display);
    const procs = [
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
          "-localhost",
          "-nopw",
        ],
        { detached: true, stdio: "ignore", env },
      ),
      spawn(
        "chromium",
        [
          `--display=${displayStr}`,
          "--no-sandbox",
          // Hides the "unsupported command-line flag" bar in the live view.
          "--test-type",
          "--no-first-run",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--start-maximized",
          "--remote-debugging-address=127.0.0.1",
          `--remote-debugging-port=${session.debugPort}`,
          `--user-data-dir=${this.profileDir(session.display)}`,
          "about:blank",
        ],
        { detached: true, stdio: "ignore", env },
      ),
    ];
    session.processes.push(...procs);
    await waitForPort(session.vncPort);
  }
}

/** Each screen's cookies, over the DevTools port of its browser. */
export const cdpCookies: CookieAccess = {
  async getAll(debugPort) {
    return (await withCdp(debugPort, (c) => c.getAllCookies(), 3_000)) as BrowserCookie[];
  },
  async set(debugPort, cookies) {
    await withCdp(debugPort, (c) => c.setCookies(cookies), 3_000);
  },
  async remove(debugPort, cookies) {
    await withCdp(debugPort, (c) => c.deleteCookies(cookies), 3_000);
  },
};

function center(bounds: { x: number; y: number; width: number; height: number }) {
  return {
    x: bounds.x + Math.floor(bounds.width / 2),
    y: bounds.y + Math.floor(bounds.height / 2),
  };
}

async function removeStaleDesktopLocks(display: number, profile: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  for (const path of [
    `/tmp/.X${display}-lock`,
    `/tmp/.X11-unix/X${display}`,
    `${profile}/SingletonLock`,
    `${profile}/SingletonSocket`,
    `${profile}/SingletonCookie`,
  ]) {
    await rm(path, { force: true }).catch(() => undefined);
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
  throw new Error(`Xvfb display :${display} did not become ready`);
}

async function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", (error) => {
          socket.destroy();
          reject(error);
        });
        socket.setTimeout(500, () => {
          socket.destroy();
          reject(new Error("connection timeout"));
        });
      });
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`VNC server on port ${port} did not become ready`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Logical key names (see COMPUTER_KEYS) → xdotool key names. */
function xdotoolKey(name: string): string {
  return name === "Enter" ? "Return" : name;
}
