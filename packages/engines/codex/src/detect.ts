import type { EngineStatus } from "@openbot/contracts";
import { resolveCliCommand, runCommand } from "@openbot/engines-common";
import { CODEX_MIN_VERSION } from "./generated/protocol.js";

export async function detectCodex(codexPath?: string | null): Promise<EngineStatus> {
  const command = codexPath ?? (await resolveCliCommand("codex"));
  if (!command) {
    return {
      installed: false,
      login: { ok: false },
      apiKey: { ok: Boolean(process.env.OPENAI_API_KEY?.trim()) },
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
  try {
    const { stdout, code } = await runCommand(command, ["login", "status"], { timeoutMs: 10_000 });
    if (code === 0) {
      const text = stdout.trim();
      loginOk = !/not logged in/i.test(text);
    }
  } catch {
    loginOk = false;
  }

  return {
    installed: true,
    version: version ?? CODEX_MIN_VERSION,
    login: { ok: loginOk },
    apiKey: { ok: Boolean(process.env.OPENAI_API_KEY?.trim()) },
  };
}
