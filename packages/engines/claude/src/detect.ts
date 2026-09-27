import type { EngineStatus } from "@openbot/contracts";
import { resolveCliCommand, runCommand } from "@openbot/engines-common";
import { CLAUDE_MIN_VERSION } from "./models.js";

interface ClaudeAuthStatusJson {
  loggedIn?: boolean;
  authMethod?: string | null;
  email?: string | null;
  subscriptionType?: string | null;
}

export async function detectClaude(claudePath?: string | null): Promise<EngineStatus> {
  const command = claudePath ?? (await resolveCliCommand("claude"));
  if (!command) {
    return {
      installed: false,
      login: { ok: false },
      apiKey: { ok: Boolean(process.env.ANTHROPIC_API_KEY?.trim()) },
    };
  }

  let version: string | undefined;
  try {
    const { stdout } = await runCommand(command, ["--version"], { timeoutMs: 10_000 });
    version = stdout.trim() || undefined;
  } catch {
    version = undefined;
  }

  let loginOk = false;
  let account: string | undefined;
  try {
    const { stdout, code } = await runCommand(command, ["auth", "status", "--json"], {
      timeoutMs: 10_000,
    });
    if (code === 0) {
      const parsed = JSON.parse(stdout) as ClaudeAuthStatusJson;
      loginOk = Boolean(parsed.loggedIn);
      account = parsed.email ?? undefined;
    }
  } catch {
    loginOk = false;
  }

  const apiKeyOk = Boolean(process.env.ANTHROPIC_API_KEY?.trim());

  return {
    installed: true,
    version: version ?? CLAUDE_MIN_VERSION,
    login: { ok: loginOk, account },
    apiKey: { ok: apiKeyOk },
  };
}
