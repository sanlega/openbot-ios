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

export interface ShellRunner {
  run(
    command: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

/** Scripted driver for tests and headless CI. */
export class MemoryLocalDriver implements LocalDriver {
  readonly platform: LocalPlatform;
  readonly actions: Action[] = [];
  private observation: Observation = {
    url: "local://desktop",
    title: "Local desktop",
    elements: [{ index: 0, role: "button", label: "OK" }],
  };

  constructor(platform: LocalPlatform = "linux") {
    this.platform = platform;
  }

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
