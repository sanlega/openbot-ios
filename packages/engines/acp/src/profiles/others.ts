import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runCli as runCommand } from "../spawn.js";
import type { TurnInput } from "@openbot/contracts";
import type { AcpProfile } from "../profile.js";
import { writeFenceDenies } from "../write-fence.js";

async function versionOf(command: string, args = ["--version"]): Promise<string | undefined> {
  try {
    const { stdout } = await runCommand(command, args, { timeoutMs: 10_000 });
    return stdout.trim().split(/\r?\n/)[0] || undefined;
  } catch {
    return undefined;
  }
}

/** Cursor's lost-connection diagnostics arrive as the reply text (T3 Code found the same). */
const CURSOR_TRANSPORT =
  /^Error: (?:RetriableError: (?!\[internal\]).+|ConnectError: \[(?:unavailable|aborted|deadline_exceeded)\].*)$/;
const CURSOR_SERVER_ERROR = "Something went wrong communicating with the server. Please try again.";

export function cursorReplyFailure(reply: string): string | undefined {
  const lines = reply
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return undefined;
  const [first, ...rest] = lines;
  const isDiagnostic = CURSOR_TRANSPORT.test(first!) || first === CURSOR_SERVER_ERROR;
  // Only a reply that is nothing but the dump (plus a stack trace); an explanation that quotes
  // one is a real answer.
  if (!isDiagnostic || !rest.every((l) => /^\s+at\s/.test(l))) return undefined;
  return `Cursor lost its connection to Cursor's servers (${first}). Try again in a moment.`;
}

interface CursorAbout {
  version?: string;
  email?: string;
}

async function cursorAbout(
  command: string,
  env?: Record<string, string>,
): Promise<CursorAbout | undefined> {
  try {
    const { stdout, code } = await runCommand(command, ["about", "--format", "json"], {
      env,
      timeoutMs: 20_000,
    });
    if (code !== 0) return undefined;
    const about = JSON.parse(stdout) as { cliVersion?: string; userEmail?: string | null };
    const email = typeof about.userEmail === "string" ? about.userEmail.trim() : "";
    return { version: about.cliVersion, ...(email ? { email } : {}) };
  } catch {
    return undefined;
  }
}

/**
 * A private home for Cursor Bots. Cursor reads `~/.cursor` for the owner's MCP servers, hooks,
 * skills, rules and plugins (seen live: an owner hook blocked every MCP call of a Bot), while
 * its sign-in lives in the system credential store, so a private home keeps the login and
 * drops the rest (D-031). The owner's git identity is copied so commits still have an author.
 */
function cursorHome(stateDir: string): Record<string, string> {
  const home = join(stateDir, "home");
  mkdirSync(home, { recursive: true });
  const gitconfig = join(homedir(), ".gitconfig");
  if (existsSync(gitconfig) && !existsSync(join(home, ".gitconfig"))) {
    copyFileSync(gitconfig, join(home, ".gitconfig"));
  }
  return { HOME: home, USERPROFILE: home };
}

/**
 * Cursor writes files without asking (only shell commands and MCP tools ask), so OpenBot's
 * permission preset becomes Cursor's own deny rules in the private home: Full denies nothing,
 * Workspace denies writes outside the workspace, Read only denies every write. No command is
 * pre-allowed, so each one asks OpenBot's broker.
 */
function writeCursorPermissions(home: string, input: TurnInput): void {
  const file = join(home, ".cursor", "cli-config.json");
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    config = { version: 1 };
  }
  const deny =
    input.permission === "full"
      ? []
      : input.permission === "read_only"
        ? ["Write(**)"]
        : writeFenceDenies([input.cwd, ...input.addDirs]).map((p) => `Write(${p})`);
  config.permissions = { allow: [], deny };
  mkdirSync(join(home, ".cursor"), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2));
}

/** Cursor CLI (`cursor-agent acp`), signed in with `cursor-agent login`. */
export function cursorProfile(): AcpProfile {
  // Whether the sign-in works from the private home; decided by `detect()`, before any turn.
  let isolated = true;
  return {
    id: "cursor",
    label: "Cursor",
    binaries: ["cursor-agent"],
    loginCommand: "cursor-agent login",
    installUrl: "https://cursor.com/cli",
    summary: "Cursor's agent with the owner's Cursor subscription: strong at coding.",
    authMethodId: "cursor_login",
    async detect(command, env) {
      const privateAbout = await cursorAbout(command, cursorHome(env.stateDir));
      if (privateAbout?.email) {
        isolated = true;
        return { version: privateAbout.version, login: { ok: true, account: privateAbout.email } };
      }
      // Some systems keep the sign-in under the home folder: use the real one then.
      const about = await cursorAbout(command);
      if (about?.email) {
        isolated = false;
        return { version: about.version, login: { ok: true, account: about.email } };
      }
      return {
        version: about?.version ?? privateAbout?.version ?? (await versionOf(command)),
        login: { ok: false },
      };
    },
    async listModels() {
      // Cursor lists its models inside a session (the `model` option); they are learned then.
      return [{ id: "auto", label: "Cursor Auto" }];
    },
    async launch(input, env) {
      // Without the private home, `--approve-mcps` would also approve the owner's own servers.
      if (!isolated) return { args: ["acp"], env: {}, systemPrompt: "prompt" };
      const home = cursorHome(env.stateDir);
      writeCursorPermissions(home.HOME!, input);
      return { args: ["--approve-mcps", "acp"], env: home, systemPrompt: "prompt" };
    },
    replyFailure: cursorReplyFailure,
  };
}

/** Gemini CLI in ACP mode. Signs in on its first interactive run, or with `GEMINI_API_KEY`. */
export function geminiProfile(): AcpProfile {
  // `--acp` replaced `--experimental-acp` (still accepted, deprecated) in newer releases.
  let acpFlag = "--experimental-acp";
  return {
    id: "gemini",
    label: "Gemini CLI",
    binaries: ["gemini"],
    loginCommand: "gemini",
    installUrl: "https://github.com/google-gemini/gemini-cli",
    summary: "Google's Gemini agent: long context, good at research and reading large codebases.",
    async detect(command) {
      const version = await versionOf(command);
      try {
        const { stdout } = await runCommand(command, ["--help"], { timeoutMs: 15_000 });
        if (/^\s*--acp\b/m.test(stdout)) acpFlag = "--acp";
      } catch {
        // Keep the older flag.
      }
      const signedIn =
        Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) ||
        existsSync(join(homedir(), ".gemini", "oauth_creds.json"));
      return { version, login: { ok: signedIn } };
    },
    async listModels() {
      return [{ id: "default", label: "Gemini default" }];
    },
    async launch(input) {
      const model = input.model && input.model !== "default" && input.model !== "auto";
      return {
        args: [...(model ? ["-m", input.model] : []), acpFlag],
        env: {},
        systemPrompt: "prompt",
      };
    },
  };
}

/** xAI's Grok Build CLI (`grok agent stdio`), signed in with `grok login`. */
export function grokProfile(): AcpProfile {
  return {
    id: "grok",
    label: "Grok Build",
    binaries: ["grok"],
    loginCommand: "grok login",
    installUrl: "https://x.ai/cli",
    summary: "xAI's Grok agent with the owner's xAI account.",
    async detect(command) {
      const version = await versionOf(command);
      try {
        // `grok models` reports the sign-in state without starting an agent.
        const { stdout, stderr, code } = await runCommand(command, ["models"], {
          timeoutMs: 15_000,
        });
        const text = `${stdout}\n${stderr}`;
        return {
          version,
          login: { ok: code === 0 && !/not (logged|signed) in|grok login/i.test(text) },
        };
      } catch {
        return { version, login: { ok: false } };
      }
    },
    async listModels(command) {
      try {
        const { stdout, code } = await runCommand(command, ["models"], { timeoutMs: 15_000 });
        if (code !== 0) return [];
        return stdout
          .split(/\r?\n/)
          .map(
            (l) =>
              l
                .trim()
                .replace(/^[-*•]\s*/, "")
                .split(/\s+/)[0] ?? "",
          )
          .filter((id) => /^grok[\w.:-]*$/i.test(id))
          .map((id) => ({ id, label: id }));
      } catch {
        return [];
      }
    },
    async launch() {
      return { args: ["agent", "stdio"], env: {}, systemPrompt: "prompt" };
    },
  };
}

export interface CustomAcpEngine {
  /** Lowercase slug; the engine id is `acp-<slug>`. */
  slug: string;
  label: string;
  command: string;
  args: string[];
}

/** Any other ACP agent the owner adds by command line (Goose, Qwen Code, Copilot CLI...). */
export function customProfile(engine: CustomAcpEngine): AcpProfile {
  return {
    id: `acp-${engine.slug}`,
    label: engine.label,
    binaries: [engine.command],
    summary: `${engine.label} (an ACP agent the owner added).`,
    async detect(command) {
      return { version: await versionOf(command), login: { ok: true } };
    },
    async listModels() {
      return [];
    },
    async launch() {
      return { args: engine.args, env: {}, systemPrompt: "prompt" };
    },
  };
}
