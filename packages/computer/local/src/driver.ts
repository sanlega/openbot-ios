import type { Action, ActResult, Observation } from "@openbot/contracts";

export type LocalPlatform = "darwin" | "win32" | "linux" | "unsupported";

export function detectLocalPlatform(): LocalPlatform {
  switch (process.platform) {
    case "darwin":
    case "win32":
    case "linux":
      return process.platform;
    default:
      return "unsupported";
  }
}

export interface LocalDriver {
  platform: LocalPlatform;
  observe(): Promise<Observation>;
  act(action: Action): Promise<ActResult>;
}

/** Scripted driver for tests and headless CI. */
export class MemoryLocalDriver implements LocalDriver {
  readonly platform: LocalPlatform = "linux";
  readonly actions: Action[] = [];
  private observation: Observation = {
    url: "local://desktop",
    title: "Local desktop",
    elements: [{ index: 0, role: "button", label: "OK" }],
  };

  setObservation(observation: Observation): void {
    this.observation = observation;
  }

  async observe(): Promise<Observation> {
    return this.observation;
  }

  async act(action: Action): Promise<ActResult> {
    this.actions.push(action);
    return { ok: true };
  }
}

export interface ShellRunner {
  run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
}

/** Linux X11 driver via xdotool (plan WS9 spike: xdotool on X11). */
export class LinuxX11Driver implements LocalDriver {
  readonly platform: LocalPlatform = "linux";

  constructor(private readonly shell: ShellRunner) {}

  async observe(): Promise<Observation> {
    const tree = await this.shell.run("xdotool", ["search", "--onlyvisible", "--name", ".*"]);
    const windowIds = tree.stdout.trim().split("\n").filter(Boolean).slice(0, 20);

    const elements = windowIds.map((id, index) => ({
      index,
      role: "window",
      label: `window-${id}`,
    }));

    return {
      url: "local://x11",
      title: "X11 desktop",
      elements,
    };
  }

  async act(action: Action): Promise<ActResult> {
    switch (action.op) {
      case "click":
        if (action.target === undefined) return { ok: false, reason: "click requires target" };
        return this.clickTarget(action.target);
      case "type":
        if (!action.text) return { ok: false, reason: "type requires text" };
        await this.shell.run("xdotool", ["type", "--", action.text]);
        return { ok: true };
      case "key":
        if (action.text) await this.shell.run("xdotool", ["key", action.text]);
        return { ok: true };
      case "scroll":
      case "wait":
      case "done":
        return { ok: true };
      case "navigate":
        return { ok: false, reason: "navigate not supported on local X11 driver" };
      default:
        return { ok: false, reason: `unsupported op: ${action.op}` };
    }
  }

  private async clickTarget(target: number): Promise<ActResult> {
    const tree = await this.observe();
    const element = tree.elements[target];
    if (!element) return { ok: false, reason: `unknown target ${target}` };
    const windowId = element.label.replace("window-", "");
    await this.shell.run("xdotool", ["windowactivate", windowId, "click", "1"]);
    return { ok: true };
  }
}

export function createLocalDriver(shell?: ShellRunner): LocalDriver {
  if (process.platform === "linux" && shell) {
    return new LinuxX11Driver(shell);
  }
  return new MemoryLocalDriver();
}
