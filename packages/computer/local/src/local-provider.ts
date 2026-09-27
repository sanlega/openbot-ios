import type {
  Action,
  ActResult,
  ComputerProvider,
  ComputerStatus,
  Observation,
  Screen,
} from "@openbot/contracts";
import { createLocalDriver, detectLocalPlatform, type LocalDriver } from "./driver.js";

export type ApprovalHandler = (input: {
  botId: string;
  action: Action;
  observation: Observation;
}) => Promise<"allow" | "deny">;

export interface LocalProviderOptions {
  driver?: LocalDriver;
  /** When true (default), every act() asks the handler before executing. */
  askEveryTime?: boolean;
  approvalHandler?: ApprovalHandler;
}

/**
 * Opt-in local-machine provider (plan WS9 U6/O1): cross-platform sidecar with
 * "ask every time" through the approval handler / permission broker.
 */
export class LocalProvider implements ComputerProvider {
  readonly id = "local";
  private started = false;
  private readonly screens = new Map<string, LocalScreen>();

  constructor(private readonly options: LocalProviderOptions = {}) {}

  async status(): Promise<ComputerStatus> {
    const platform = detectLocalPlatform();
    if (platform === "unsupported") {
      return { ready: false, detail: `unsupported platform: ${process.platform}` };
    }
    return {
      ready: this.started,
      detail: this.started ? `local (${platform})` : "not started",
    };
  }

  async ensureStarted(): Promise<void> {
    if (detectLocalPlatform() === "unsupported") {
      throw new Error(`LocalProvider unsupported on ${process.platform}`);
    }
    this.started = true;
  }

  async screen(botId: string): Promise<Screen> {
    if (!this.started) throw new Error("LocalProvider.screen() called before ensureStarted()");
    let screen = this.screens.get(botId);
    if (!screen) {
      const driver = this.options.driver ?? createLocalDriver();
      screen = new LocalScreen(botId, driver, this.options);
      this.screens.set(botId, screen);
    }
    return screen;
  }
}

class LocalScreen implements Screen {
  private lastObservedIndices: Set<number> | undefined;

  constructor(
    private readonly botId: string,
    private readonly driver: LocalDriver,
    private readonly options: LocalProviderOptions,
  ) {}

  async observe(): Promise<Observation> {
    const observation = await this.driver.observe();
    this.lastObservedIndices = new Set(observation.elements.map((el) => el.index));
    return observation;
  }

  async act(action: Action): Promise<ActResult> {
    if (action.target !== undefined && !this.lastObservedIndices?.has(action.target)) {
      return { ok: false, reason: `index ${action.target} was not returned by the last observe()` };
    }

    const askEveryTime = this.options.askEveryTime ?? true;
    if (
      askEveryTime &&
      this.options.approvalHandler &&
      action.op !== "wait" &&
      action.op !== "done"
    ) {
      const observation = await this.driver.observe();
      const decision = await this.options.approvalHandler({
        botId: this.botId,
        action,
        observation,
      });
      if (decision === "deny") {
        return { ok: false, reason: "user denied local computer action" };
      }
    }

    return this.driver.act(action);
  }

  async liveView(): Promise<{ url: string; token: string; expiresAt: string }> {
    return {
      url: "local://live-view-not-supported",
      token: "local",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async takeover(_on: boolean): Promise<void> {
    // Local takeover is handled by the OS user directly.
  }
}

export function createLocalProvider(options?: LocalProviderOptions): LocalProvider {
  return new LocalProvider(options);
}
