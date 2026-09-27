import type { TurnInput } from "@openbot/contracts";

export type EngineAuthEngine = "claude" | "codex";

const ANTHROPIC_KEY_ENV = "ANTHROPIC_API_KEY";
const OPENAI_KEY_ENV = "OPENAI_API_KEY";

/** Build subprocess env for a turn (plan §4.3, D-005). Secrets never enter prompts. */
export function buildTurnEnv(engine: EngineAuthEngine, auth: TurnInput["auth"]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...auth.env };
  if (auth.mode === "api_key") {
    if (engine === "claude" && auth.env[ANTHROPIC_KEY_ENV]) {
      env[ANTHROPIC_KEY_ENV] = auth.env[ANTHROPIC_KEY_ENV];
    }
    if (engine === "codex" && auth.env[OPENAI_KEY_ENV]) {
      env[OPENAI_KEY_ENV] = auth.env[OPENAI_KEY_ENV];
    }
  }
  return env;
}

export async function validateAnthropicKey(key: string): Promise<{ ok: boolean; reason?: string }> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, reason: "empty key" };
  if (!trimmed.startsWith("sk-")) return { ok: false, reason: "invalid Anthropic key format" };
  return { ok: true };
}

export async function validateOpenAiKey(key: string): Promise<{ ok: boolean; reason?: string }> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, reason: "empty key" };
  if (!trimmed.startsWith("sk-")) return { ok: false, reason: "invalid OpenAI key format" };
  return { ok: true };
}

export { ANTHROPIC_KEY_ENV, OPENAI_KEY_ENV };
