import { describe, expect, it } from "vitest";
import type { Action, Observation } from "@openbot/contracts";
import { ScreenManager } from "./screen-manager.js";
import { DockerProvider } from "./docker-provider.js";
import type { ControlDaemonClient } from "./control-daemon.js";

class MemoryControlDaemon implements ControlDaemonClient {
  readonly actions: Action[] = [];
  private page: Observation = {
    url: "https://docker.local/inbox",
    title: "Inbox",
    elements: [
      { index: 0, role: "link", label: "Compose" },
      { index: 1, role: "button", label: "Refresh" },
    ],
  };

  async health() {
    return { ok: true };
  }

  async observe(): Promise<Observation> {
    return this.page;
  }

  async act(_botId: string, _display: number, action: Action) {
    this.actions.push(action);
    return { ok: true };
  }

  async liveView(botId: string) {
    return {
      url: `http://127.0.0.1:6080/vnc.html?bot=${botId}`,
      token: "test-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }
}

describe("ScreenManager", () => {
  it("LRU-evicts the least recently used bot when maxScreens is exceeded", () => {
    const manager = new ScreenManager(2);
    manager.assign("bot_a");
    manager.assign("bot_b");
    manager.assign("bot_c");
    expect(manager.getDisplay("bot_a")).toBeUndefined();
    expect(manager.getDisplay("bot_b")).toBeDefined();
    expect(manager.getDisplay("bot_c")).toBeDefined();
  });
});

describe("DockerProvider (mocked engine)", () => {
  it("starts against a mocked docker engine and proxies observe/act", async () => {
    const daemon = new MemoryControlDaemon();
    const provider = new DockerProvider({
      controlClient: daemon,
      idleStopMs: 0,
      docker: {
        ping: async () => {},
        listContainers: async () => [],
        getContainer: () => ({
          inspect: async () => ({ State: { Running: true } }),
          start: async () => {},
        }),
        createContainer: async () => ({
          id: "ctr_test",
          start: async () => {},
        }),
      },
    });

    await provider.ensureStarted();
    expect((await provider.status()).ready).toBe(true);

    const screen = await provider.screen("bot_1");
    const observation = await screen.observe();
    expect(observation.elements[0]?.label).toBe("Compose");

    const live = await screen.liveView();
    expect(live.url).toContain("vnc");

    const bad = await screen.act({ op: "click", target: 999 });
    expect(bad.ok).toBe(false);

    const good = await screen.act({ op: "click", target: 0 });
    expect(good.ok).toBe(true);
    expect(daemon.actions).toHaveLength(1);
  });
});

const dockerIntegration = process.env.OPENBOT_DOCKER === "1" ? describe : describe.skip;

dockerIntegration("DockerProvider integration", () => {
  it("connects to a running desktop container", async () => {
    try {
      const provider = new DockerProvider({
        controlPort: Number(process.env.OPENBOT_DOCKER_PORT ?? 8787),
      });
      await provider.ensureStarted();
      const status = await provider.status();
      expect(status.ready).toBe(true);
    } catch (error) {
      const message = String(error);
      if (message.includes("EACCES") || message.includes("permission denied")) return;
      throw error;
    }
  });
});

describe("DockerProvider concurrent start-up", () => {
  it("runs one start-up for simultaneous ensureStarted calls (one container, one Docker launch)", async () => {
    let created = 0;
    let pings = 0;
    const provider = new DockerProvider({
      controlClient: new MemoryControlDaemon(),
      idleStopMs: 0,
      docker: {
        ping: async () => {
          pings += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
        },
        listContainers: async () => [],
        getContainer: () => {
          throw new Error("unexpected");
        },
        createContainer: async () => {
          created += 1;
          return { id: "cont_1", start: async () => {} };
        },
      },
    });
    await Promise.all([
      provider.ensureStarted(),
      provider.ensureStarted(),
      provider.ensureStarted(),
    ]);
    expect(created).toBe(1);
    expect(pings).toBe(1);
  });
});

describe("DockerProvider shared workspace and sign-ins (D-032)", () => {
  function engine(existing?: { binds: string[]; running?: boolean }) {
    const created: Array<{ HostConfig: { Binds: string[] }; Env: string[] }> = [];
    let removed = false;
    return {
      created,
      removed: () => removed,
      docker: {
        ping: async () => {},
        listContainers: async () =>
          existing && !removed ? [{ Id: "old", Names: ["/openbot-desktop"] }] : [],
        getContainer: () => ({
          inspect: async () => ({
            State: { Running: existing?.running ?? true },
            Config: { Env: ["OPENBOT_CONTROL_TOKEN=saved"] },
            HostConfig: { Binds: existing?.binds ?? [] },
          }),
          start: async () => {},
          remove: async () => {
            removed = true;
          },
        }),
        createContainer: async (options: unknown) => {
          created.push(options as (typeof created)[number]);
          return { id: "new", start: async () => {} };
        },
      },
    };
  }
  const daemon = new MemoryControlDaemon();

  it("mounts the bots' workspace and the browser volume", async () => {
    const e = engine();
    await new DockerProvider({
      docker: e.docker,
      controlClient: daemon,
      idleStopMs: 0,
      workspaceMount: "C:\\Users\\me\\.openbot\\workspace",
    }).ensureStarted();
    expect(e.created[0]!.HostConfig.Binds).toEqual([
      "C:\\Users\\me\\.openbot\\workspace:/workspace",
      "openbot-browser:/data/browser",
    ]);
    expect(e.created[0]!.Env).toContain("OPENBOT_BROWSER_DIR=/data/browser");
  });

  it("replaces a container made without them", async () => {
    const e = engine({ binds: [] });
    await new DockerProvider({
      docker: e.docker,
      controlClient: daemon,
      idleStopMs: 0,
      workspaceMount: "/home/me/.openbot/workspace",
    }).ensureStarted();
    expect(e.removed()).toBe(true);
    expect(e.created).toHaveLength(1);
  });

  it("keeps a container that already has them", async () => {
    const e = engine({
      binds: ["/home/me/.openbot/workspace:/workspace", "openbot-browser:/data/browser"],
    });
    await new DockerProvider({
      docker: e.docker,
      controlClient: daemon,
      idleStopMs: 0,
      workspaceMount: "/home/me/.openbot/workspace",
    }).ensureStarted();
    expect(e.removed()).toBe(false);
    expect(e.created).toHaveLength(0);
  });
});
