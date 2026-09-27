import { randomBytes } from "node:crypto";
import type {
  Action,
  ActResult,
  ComputerProvider,
  ComputerStatus,
  Observation,
  Screen,
} from "@openbot/contracts";
import { type ControlDaemonClient, HttpControlDaemonClient } from "./control-daemon.js";
import { ScreenManager } from "./screen-manager.js";

export interface DockerEngine {
  ping(): Promise<void>;
  getContainer(id: string): {
    inspect(): Promise<{ State: { Running: boolean }; Config?: { Env?: string[] } }>;
    start(): Promise<void>;
  };
  createContainer(options: unknown): Promise<{ start(): Promise<void>; id: string }>;
  listContainers(options?: unknown): Promise<Array<{ Id: string; Names: string[] }>>;
}

export interface DockerProviderOptions {
  docker?: DockerEngine;
  image?: string;
  containerName?: string;
  workspaceMount?: string;
  controlPort?: number;
  liveViewBaseUrl?: string;
  controlClient?: ControlDaemonClient;
  idleStopMs?: number;
}

const DEFAULT_IMAGE = "openbot/desktop:latest";
const DEFAULT_CONTAINER = "openbot-desktop";

/**
 * Docker-backed computer provider (plan WS9): one shared desktop container with
 * per-bot displays (`maxScreens` 4, LRU) and tokenized noVNC live view.
 */
export class DockerProvider implements ComputerProvider {
  readonly id = "docker";
  private started = false;
  private containerId: string | undefined;
  private readonly screens = new ScreenManager(4);
  private controlToken: string;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: DockerProviderOptions = {}) {
    this.controlToken = randomBytes(16).toString("hex");
  }

  async status(): Promise<ComputerStatus> {
    if (!this.started) return { ready: false, detail: "not started" };
    try {
      const client = this.controlClient();
      const health = await client.health();
      return { ready: health.ok, detail: health.ok ? undefined : "control daemon unhealthy" };
    } catch (error) {
      return { ready: false, detail: String(error) };
    }
  }

  async ensureStarted(): Promise<void> {
    if (this.started) {
      if ((await this.status()).ready) {
        this.scheduleIdleStop();
        return;
      }
      this.started = false;
    }

    const docker = await this.resolveDocker();
    await docker.ping();

    const name = this.options.containerName ?? DEFAULT_CONTAINER;
    const existing = await docker.listContainers({ all: true });
    const match = existing.find((c) => c.Names.some((n) => n === `/${name}`));

    if (match) {
      this.containerId = match.Id;
      const container = docker.getContainer(match.Id);
      const info = await container.inspect();
      const savedToken = info.Config?.Env?.find((item) =>
        item.startsWith("OPENBOT_CONTROL_TOKEN="),
      );
      if (!savedToken) throw new Error(`desktop container ${name} has no control token`);
      this.controlToken = savedToken.slice("OPENBOT_CONTROL_TOKEN=".length);
      if (!info.State.Running) await container.start();
    } else {
      const image = this.options.image ?? DEFAULT_IMAGE;
      const port = this.options.controlPort ?? 8787;
      const created = await docker.createContainer({
        Image: image,
        name,
        Env: [`OPENBOT_CONTROL_TOKEN=${this.controlToken}`, "OPENBOT_MAX_SCREENS=4"],
        HostConfig: {
          Binds: this.options.workspaceMount ? [`${this.options.workspaceMount}:/workspace`] : [],
          PortBindings: {
            "8787/tcp": [{ HostIp: "127.0.0.1", HostPort: String(port) }],
            "6080/tcp": [{ HostIp: "127.0.0.1", HostPort: "6080" }],
          },
          AutoRemove: false,
        },
        ExposedPorts: { "8787/tcp": {}, "6080/tcp": {} },
      });
      await created.start();
      this.containerId = created.id;
    }

    this.started = true;
    const deadline = Date.now() + 15_000;
    while (!(await this.status()).ready) {
      if (Date.now() >= deadline) {
        this.started = false;
        throw new Error("desktop control daemon did not become ready");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    this.scheduleIdleStop();
  }

  async screen(botId: string): Promise<Screen> {
    if (!this.started) throw new Error("DockerProvider.screen() called before ensureStarted()");
    const display = this.screens.assign(botId);
    return new DockerScreen(botId, display, this.controlClient(), this.options.liveViewBaseUrl);
  }

  /** Stop the container after idle (plan: stop after idle). Test hook. */
  scheduleIdleStop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const idleMs = this.options.idleStopMs ?? 30 * 60_000;
    if (idleMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      void this.stop();
    }, idleMs);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }

  getContainerId(): string | undefined {
    return this.containerId;
  }

  getControlToken(): string {
    return this.controlToken;
  }

  private controlClient(): ControlDaemonClient {
    if (this.options.controlClient) return this.options.controlClient;
    const port = this.options.controlPort ?? 8787;
    return new HttpControlDaemonClient({
      baseUrl: `http://127.0.0.1:${port}`,
      token: this.controlToken,
    });
  }

  private async resolveDocker(): Promise<DockerEngine> {
    if (this.options.docker) return this.options.docker;
    const Docker = (await import("dockerode")).default;
    return new Docker() as unknown as DockerEngine;
  }
}

class DockerScreen implements Screen {
  private lastObservedIndices: Set<number> | undefined;
  private takenOver = false;

  constructor(
    private readonly botId: string,
    private readonly display: number,
    private readonly control: ControlDaemonClient,
    private readonly liveViewBaseUrl?: string,
  ) {}

  async observe(): Promise<Observation> {
    const observation = await this.control.observe(this.botId, this.display);
    this.lastObservedIndices = new Set(observation.elements.map((el) => el.index));
    return observation;
  }

  async act(action: Action): Promise<ActResult> {
    if (this.takenOver && action.op !== "wait" && action.op !== "done") {
      return { ok: false, reason: "screen is under user takeover" };
    }
    if (action.target !== undefined) {
      if (!this.lastObservedIndices?.has(action.target)) {
        return {
          ok: false,
          reason: `index ${action.target} was not returned by the last observe()`,
        };
      }
    }
    return this.control.act(this.botId, this.display, action);
  }

  async liveView(): Promise<{ url: string; token: string; expiresAt: string }> {
    const live = await this.control.liveView(this.botId);
    if (this.liveViewBaseUrl) {
      const url = new URL(live.url);
      return {
        ...live,
        url: `${this.liveViewBaseUrl}${url.search}`,
      };
    }
    return live;
  }

  async takeover(on: boolean): Promise<void> {
    this.takenOver = on;
  }
}

export function createDockerProvider(options?: DockerProviderOptions): DockerProvider {
  return new DockerProvider(options);
}
