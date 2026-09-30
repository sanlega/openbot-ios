import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * OpenBot's Bots run Codex from a private CODEX_HOME, not the owner's personal one.
 *
 * The owner's `~/.codex` carries their own plugins, MCP servers (even ones that drive their
 * screen), global instructions, notify hooks, and `approval_policy = never`. Every OpenBot Bot
 * silently inherited all of it: a Chief "could publish to Sites" (a personal plugin) and could not
 * use OpenBot's tools. The private home has only the login.
 */
export function defaultOpenbotCodexHome(): string {
  const base = process.env.OPENBOT_HOME || join(homedir(), ".openbot");
  return join(base, "codex-home");
}

/** Where the owner's own Codex keeps its login. */
export function ownerCodexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

const AUTH_FILE = "auth.json";
const CONFIG = `# Managed by OpenBot: a private Codex home for its Bots. Only the login is shared with the
# owner's own Codex; plugins, MCP servers and instructions are not.
cli_auth_credentials_store = "file"
# Codex treats the nearest folder above a Bot's working folder that holds a .git or .codex as its
# "project" and loads that folder's config: for a workspace under the owner's user folder that is the
# owner's own ~/.codex (their MCP servers, skills, plugins). A marker nothing has means the working
# folder itself is the project.
project_root_markers = [".openbot-no-such-marker"]
`;

interface AuthFile {
  raw: string;
  /** When Codex last refreshed this login (`last_refresh`), else the file's mtime. */
  at: number;
}

/** `unreadable` (locked, half-written) is not `missing`: never treat it as a sign-out. */
async function readAuth(path: string): Promise<AuthFile | "missing" | "unreadable"> {
  try {
    const raw = await readFile(path, "utf8");
    let at = Number.NaN;
    try {
      at = Date.parse((JSON.parse(raw) as { last_refresh?: string }).last_refresh ?? "");
    } catch {
      // Not JSON we understand: fall back to the mtime.
    }
    if (Number.isNaN(at)) at = (await stat(path)).mtimeMs;
    return { raw, at };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
  }
}

async function writeAuth(path: string, raw: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, raw, { mode: 0o600 });
  await rename(temp, path);
}

/**
 * Codex refreshes its login in place. With two homes each could refresh and leave the other with a
 * spent token, so the login that was refreshed last wins, in both directions. The owner's own file is
 * the source of truth for being logged in: if it is gone (they signed out) the private copy goes too,
 * and a private login is never written where the owner has none.
 */
export class CodexHome {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    readonly dir: string = defaultOpenbotCodexHome(),
    private readonly owner: string = ownerCodexHome(),
  ) {}

  private get ownAuth(): string {
    return join(this.dir, AUTH_FILE);
  }

  private get ownerAuth(): string {
    return join(this.owner, AUTH_FILE);
  }

  /** Creates the private home and brings the owner's current login in. */
  async prepare(): Promise<{ hasLogin: boolean }> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, "config.toml"), CONFIG, { flag: "w" });
    await this.sync();
    return { hasLogin: (await readAuth(this.ownAuth)) !== "missing" };
  }

  /** Keeps the two logins in step while Codex runs (a refresh may happen in either home). */
  startSync(everyMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sync().catch(() => undefined), everyMs);
    this.timer.unref?.();
  }

  async sync(): Promise<void> {
    const owner = await readAuth(this.ownerAuth);
    const own = await readAuth(this.ownAuth);
    // A file that is locked or mid-write says nothing about who is signed in: try again next time.
    if (owner === "unreadable" || own === "unreadable") return;
    if (owner === "missing") {
      // Signed out (or the login lives in the OS keyring, which OpenBot can't read).
      if (own !== "missing") await rm(this.ownAuth, { force: true });
      return;
    }
    if (own === "missing" || owner.at > own.at) await writeAuth(this.ownAuth, owner.raw);
    else if (own.at > owner.at) await writeAuth(this.ownerAuth, own.raw);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.sync().catch(() => undefined);
  }
}
