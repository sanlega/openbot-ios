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

  async liveView(display: number) {
    return {
      url: `http://127.0.0.1:6080/vnc.html?display=${display}`,
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
    const provider = new DockerProvider({
      controlPort: Number(process.env.OPENBOT_DOCKER_PORT ?? 8787),
    });
    await provider.ensureStarted();
    const status = await provider.status();
    expect(status.ready).toBe(true);
  });
});
