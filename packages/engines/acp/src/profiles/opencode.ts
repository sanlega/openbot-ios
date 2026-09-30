import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelInfo, TurnInput } from "@openbot/contracts";
import { resolveCliCommand } from "@openbot/engines-common";
import { runCli as runCommand } from "../spawn.js";
import {
  discoverLocalModels,
  ensureOllamaContext,
  localServers,
  parseLocalModelId,
  type LocalServers,
} from "../local-models.js";
import type { AcpEnvironment, AcpLaunch, AcpProfile } from "../profile.js";

export interface OpenCodeProfileOptions {
  servers?: LocalServers;
  fetch?: typeof fetch;
  /** Where the owner's own OpenCode keeps its sign-ins (`auth.json`). */
  ownerDataDir?: string;
  /** Loads an LM Studio model with enough context (tests stub it). */
  loadLmStudioModel?: (name: string, contextLength: number) => Promise<void>;
}

/**
 * OpenCode (`opencode acp`): the owner's cloud providers (with their own `opencode auth login`),
 * OpenCode's free models, and local models from Ollama or LM Studio (D-031).
 *
 * Isolation (the Codex lesson, D-027): OpenCode reads the owner's global config, plugins,
 * skills, MCP servers and even Claude Code's `~/.claude` skills. Bots get private XDG dirs
 * under `~/.openbot/engines/opencode`, those loaders switched off, and only the owner's
 * sign-ins passed through (`OPENCODE_AUTH_CONTENT`).
 */
export function openCodeProfile(options: OpenCodeProfileOptions = {}): AcpProfile {
  const servers = options.servers ?? localServers();
  const doFetch = options.fetch ?? fetch;
  const ownerDataDir =
    options.ownerDataDir ??
    join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode");
  const loadLmStudio = options.loadLmStudioModel ?? loadLmStudioModel;

  const envFor = (env: AcpEnvironment): Record<string, string> => {
    const out: Record<string, string> = {
      XDG_CONFIG_HOME: join(env.stateDir, "config"),
      XDG_DATA_HOME: join(env.stateDir, "data"),
      XDG_STATE_HOME: join(env.stateDir, "state"),
      XDG_CACHE_HOME: join(env.stateDir, "cache"),
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_PURE: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_SHARE: "1",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
    };
    const auth = readOwnerAuth(ownerDataDir);
    if (auth) out.OPENCODE_AUTH_CONTENT = auth;
    return out;
  };

  return {
    id: "opencode",
    label: "OpenCode",
    binaries: ["opencode"],
    loginCommand: "opencode auth login",
    installUrl: "https://opencode.ai",
    summary:
      "OpenCode agent: many cloud providers, free models, and local models (Ollama, LM Studio).",

    async detect(command) {
      const { stdout } = await runCommand(command, ["--version"], { timeoutMs: 10_000 });
      // Free models and local ones need no sign-in.
      return { version: stdout.trim() || undefined, login: { ok: true } };
    },

    async listModels(command, env) {
      // Local servers and OpenCode's own list are asked at the same time.
      const [local, cloud] = await Promise.all([
        discoverLocalModels(servers, doFetch),
        cloudModels(command, envFor(env)),
      ]);
      return [...local, ...cloud.slice(0, 200)];
    },

    async launch(input, env): Promise<AcpLaunch> {
      const model = await resolveModel(input.model, servers, doFetch, loadLmStudio);
      const promptFile = writePrompt(env.stateDir, input);
      const config: Record<string, unknown> = {
        $schema: "https://opencode.ai/config.json",
        autoupdate: false,
        share: "disabled",
        instructions: promptFile ? [promptFile] : [],
        // Everything that acts asks, so OpenBot's permission broker decides (under Full it
        // allows without a card; built-in denies still hold).
        permission: {
          edit: "ask",
          bash: "ask",
          webfetch: "ask",
          websearch: "ask",
          codesearch: "ask",
          external_directory: "ask",
          doom_loop: "ask",
          task: "ask",
        },
        provider: providerConfig(servers, model.local),
        ...(model.value ? { model: model.value } : {}),
      };
      return {
        args: ["acp"],
        env: { ...envFor(env), OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
        systemPrompt: promptFile ? "launch" : "prompt",
        model: model.value,
      };
    },
  };
}

/** The providers the owner signed in to with `opencode auth login`, and OpenCode's free models. */
async function cloudModels(command: string, env: Record<string, string>): Promise<ModelInfo[]> {
  const cloud: ModelInfo[] = [];
  try {
    const { stdout, code } = await runCommand(command, ["models"], { env, timeoutMs: 20_000 });
    if (code !== 0) return cloud;
    for (const line of stdout.split(/\r?\n/)) {
      const id = line.trim();
      if (/^[\w.-]+\/[\w.:@/-]+$/.test(id) && !parseLocalModelId(id)) cloud.push({ id, label: id });
    }
  } catch {
    // Local models are still listed.
  }
  return cloud;
}

interface ResolvedModel {
  /** OpenCode's `provider/model` value, or undefined for OpenCode's own default. */
  value?: string;
  local?: { provider: "ollama" | "lmstudio"; name: string };
}

async function resolveModel(
  id: string,
  servers: LocalServers,
  doFetch: typeof fetch,
  loadLmStudio: (name: string, contextLength: number) => Promise<void>,
): Promise<ResolvedModel> {
  if (!id || id === "default" || id === "auto") return {};
  const local = parseLocalModelId(id);
  if (!local) return { value: id };
  if (local.provider === "ollama") {
    const name = await ensureOllamaContext(
      servers.ollama,
      local.name,
      servers.contextLength,
      doFetch,
    );
    return { value: `ollama/${name}`, local: { provider: "ollama", name } };
  }
  await loadLmStudio(local.name, servers.contextLength).catch(() => undefined);
  return { value: id, local };
}

function providerConfig(
  servers: LocalServers,
  local: ResolvedModel["local"],
): Record<string, unknown> {
  if (!local) return {};
  const base = local.provider === "ollama" ? servers.ollama : servers.lmstudio;
  return {
    [local.provider]: {
      npm: "@ai-sdk/openai-compatible",
      name: local.provider === "ollama" ? "Ollama" : "LM Studio",
      options: { baseURL: `${base}/v1` },
      models: { [local.name]: { name: local.name, tools: true } },
    },
  };
}

/** OpenBot's system prompt, as an OpenCode instructions file (one per Bot). */
function writePrompt(stateDir: string, input: TurnInput): string | undefined {
  if (!input.systemPrompt.trim()) return undefined;
  const dir = join(stateDir, "prompts");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${input.bot.id.replace(/[^\w-]/g, "_")}.md`);
  writeFileSync(file, input.systemPrompt);
  return file;
}

function readOwnerAuth(dir: string): string | undefined {
  const file = join(dir, "auth.json");
  try {
    if (!existsSync(file)) return undefined;
    const text = readFileSync(file, "utf8");
    JSON.parse(text);
    return text;
  } catch {
    return undefined;
  }
}

/**
 * LM Studio loads a model on first use with its default context (often 4096). Load it with
 * enough context first, through its `lms` CLI, unless it is already loaded that way.
 */
async function loadLmStudioModel(name: string, contextLength: number): Promise<void> {
  const lms =
    (await resolveCliCommand("lms")) ??
    (existsSync(
      join(homedir(), ".lmstudio", "bin", process.platform === "win32" ? "lms.exe" : "lms"),
    )
      ? join(homedir(), ".lmstudio", "bin", process.platform === "win32" ? "lms.exe" : "lms")
      : null);
  if (!lms) return;
  try {
    const { stdout } = await runCommand(lms, ["ps", "--json"], { timeoutMs: 15_000 });
    const loaded = JSON.parse(stdout) as Array<{
      identifier?: string;
      modelKey?: string;
      contextLength?: number;
    }>;
    const hit = loaded.find((m) => m.identifier === name || m.modelKey === name);
    if (hit && (hit.contextLength ?? 0) >= Math.min(contextLength, 8_192)) return;
  } catch {
    // Try to load anyway.
  }
  await runCommand(lms, ["load", name, "-c", String(contextLength), "-y"], {
    timeoutMs: 180_000,
  });
}
