import type { EngineDescriptor, ModelInfo, TurnInput } from "@openbot/contracts";

/** Where engines keep the private state OpenBot gives them (config dirs, derived configs). */
export interface AcpEnvironment {
  /** `~/.openbot/engines/<id>`: never the owner's own CLI config. */
  stateDir: string;
}

export interface AcpLaunch {
  args: string[];
  env: Record<string, string>;
  /**
   * `"launch"`: the profile already gave the agent OpenBot's system prompt (a config file).
   * `"prompt"`: ACP has no system prompt field, so it rides in front of the first message.
   */
  systemPrompt: "launch" | "prompt";
  /** The value for the session's `model` config option, if it differs from `TurnInput.model`. */
  model?: string;
}

export interface AcpDetection {
  version?: string;
  login: { ok: boolean; account?: string };
}

/**
 * One agent CLI that speaks the Agent Client Protocol (D-031). The protocol code is shared
 * (`AcpDriver`); a profile only says how to find, check, launch and describe the CLI.
 */
export interface AcpProfile {
  id: string;
  label: string;
  /** CLI names to look for on PATH, in order (or an absolute path for a custom engine). */
  binaries: string[];
  loginCommand?: string;
  installUrl?: string;
  summary?: string;
  /** ACP `authenticate` method to call when the agent offers it (Cursor: `cursor_login`). */
  authMethodId?: string;
  /** Runs `--version`/login checks. Must not open a session, start MCP servers or a browser. */
  detect(command: string, env: AcpEnvironment): Promise<AcpDetection>;
  listModels(command: string, env: AcpEnvironment): Promise<ModelInfo[]>;
  launch(input: TurnInput, env: AcpEnvironment): Promise<AcpLaunch>;
  /** Some agents report a lost connection as the whole reply (Cursor): return it as an error. */
  replyFailure?(reply: string): string | undefined;
}

export function descriptorOf(profile: AcpProfile): EngineDescriptor {
  return {
    id: profile.id,
    label: profile.label,
    kind: "acp",
    loginCommand: profile.loginCommand,
    installUrl: profile.installUrl,
    summary: profile.summary,
    capabilities: { resume: true, steer: false },
  };
}
