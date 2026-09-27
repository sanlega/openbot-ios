import type {
  ComputerProvider,
  DecisionService,
  EngineDriver,
  EngineId,
  EngineStatus,
} from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import { FakeComputerProvider } from "@openbot/computer-fake";
import { createDockerProvider, isDockerAvailable } from "@openbot/computer-docker";
import { LocalProvider } from "@openbot/computer-local";
import { createDecisionService, FakeDecisionService } from "@openbot/decisions";
import { ClaudeDriver, detectClaude } from "@openbot/engines-claude";
import { CodexDriver, detectCodex } from "@openbot/engines-codex";
import { validateAnthropicKey, validateOpenAiKey } from "@openbot/engines-common";
import { FakeEngineDriver } from "@openbot/engines-fake";

export const VAULT_KEYS = {
  typesafe: "typesafe.apiKey",
  anthropic: "anthropic.apiKey",
  openai: "openai.apiKey",
} as const;

export interface ProviderDetection {
  detectClaude: typeof detectClaude;
  detectCodex: typeof detectCodex;
  dockerPing: () => Promise<boolean>;
}

export interface BootstrapProvidersResult {
  decisionService: DecisionService;
  drivers: Partial<Record<EngineId, EngineDriver>>;
  computerProvider?: ComputerProvider;
  engineStatuses: { claude: EngineStatus; codex: EngineStatus };
  availableEngines: EngineId[];
}

const defaultDetection: ProviderDetection = {
  detectClaude,
  detectCodex,
  dockerPing: isDockerAvailable,
};

function fakeFlag(name: string): boolean {
  return process.env[name] === "1";
}

function engineReady(status: EngineStatus): boolean {
  return status.login.ok || status.apiKey.ok;
}

/** Resolves production providers from config, vault, and environment detection. */
export async function bootstrapProviders(
  ctx: CoreContext,
  detection: ProviderDetection = defaultDetection,
): Promise<BootstrapProvidersResult> {
  const decisionService = await resolveDecisionService(ctx);
  const { drivers, engineStatuses, availableEngines } = await resolveEngineDrivers(detection);
  const computerProvider = await resolveComputerProvider(detection);

  registerSetupValidators(ctx, decisionService, detection);

  ctx.availableEngines = availableEngines;
  ctx.engineStatuses = engineStatuses;

  return { decisionService, drivers, computerProvider, engineStatuses, availableEngines };
}

async function resolveDecisionService(ctx: CoreContext): Promise<DecisionService> {
  if (fakeFlag("OPENBOT_FAKE_JEV")) return new FakeDecisionService();

  const vaultKey = await ctx.vault.get(VAULT_KEYS.typesafe);
  const apiKey = process.env.JEV_API_KEY ?? vaultKey;
  if (!apiKey) return new FakeDecisionService();

  return createDecisionService({ apiKey });
}

async function resolveEngineDrivers(detection: ProviderDetection): Promise<{
  drivers: Partial<Record<EngineId, EngineDriver>>;
  engineStatuses: { claude: EngineStatus; codex: EngineStatus };
  availableEngines: EngineId[];
}> {
  const claudeStatus = await detection.detectClaude();
  const codexStatus = await detection.detectCodex();

  if (fakeFlag("OPENBOT_FAKE_ENGINES")) {
    return {
      drivers: { fake: new FakeEngineDriver() },
      engineStatuses: { claude: claudeStatus, codex: codexStatus },
      availableEngines: ["fake"],
    };
  }

  const drivers: Partial<Record<EngineId, EngineDriver>> = {};
  const availableEngines: EngineId[] = [];

  if (engineReady(claudeStatus)) {
    drivers.claude = new ClaudeDriver();
    availableEngines.push("claude");
  }
  if (engineReady(codexStatus)) {
    drivers.codex = new CodexDriver();
    availableEngines.push("codex");
  }

  return {
    drivers,
    engineStatuses: { claude: claudeStatus, codex: codexStatus },
    availableEngines,
  };
}

async function resolveComputerProvider(
  detection: ProviderDetection,
): Promise<ComputerProvider | undefined> {
  if (fakeFlag("OPENBOT_FAKE_COMPUTER")) return new FakeComputerProvider();

  if (fakeFlag("OPENBOT_LOCAL_COMPUTER")) return new LocalProvider();

  const dockerAvailable = await detection.dockerPing();
  if (dockerAvailable) return createDockerProvider();

  return undefined;
}

function registerSetupValidators(
  ctx: CoreContext,
  decisionService: DecisionService,
  detection: ProviderDetection,
): void {
  ctx.validators.typesafe = async (value) => {
    const result = await decisionService.validateKey(value ?? "");
    if (result.ok && value) await ctx.vault.set(VAULT_KEYS.typesafe, value);
    return result.ok ? { ok: true } : { ok: false, reason: "invalid Typesafe API key" };
  };

  ctx.validators.anthropic = async (value) => {
    const result = await validateAnthropicKey(value ?? "");
    if (result.ok && value) await ctx.vault.set(VAULT_KEYS.anthropic, value);
    return result;
  };

  ctx.validators.openai = async (value) => {
    const result = await validateOpenAiKey(value ?? "");
    if (result.ok && value) await ctx.vault.set(VAULT_KEYS.openai, value);
    return result;
  };

  ctx.validators.claude_login = async (value) => {
    if (value?.trim()) {
      const keyResult = await validateAnthropicKey(value);
      if (keyResult.ok) {
        await ctx.vault.set(VAULT_KEYS.anthropic, value);
        return { ok: true };
      }
    }
    const status = await detection.detectClaude();
    if (status.login.ok) return { ok: true };
    if (status.apiKey.ok) return { ok: true };
    return { ok: false, reason: "Claude CLI not logged in and no API key configured" };
  };

  ctx.validators.codex_login = async (value) => {
    if (value?.trim()) {
      const keyResult = await validateOpenAiKey(value);
      if (keyResult.ok) {
        await ctx.vault.set(VAULT_KEYS.openai, value);
        return { ok: true };
      }
    }
    const status = await detection.detectCodex();
    if (status.login.ok) return { ok: true };
    if (status.apiKey.ok) return { ok: true };
    return { ok: false, reason: "Codex CLI not logged in and no API key configured" };
  };
}
