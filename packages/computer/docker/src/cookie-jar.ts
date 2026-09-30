import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** A cookie as Chromium's DevTools protocol reports and accepts it. */
export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  session?: boolean;
  [key: string]: unknown;
}

/** Reads and writes the cookies of one screen's browser (over CDP in the container). */
export interface CookieAccess {
  getAll(debugPort: number): Promise<BrowserCookie[]>;
  set(debugPort: number, cookies: BrowserCookie[]): Promise<void>;
  remove(
    debugPort: number,
    cookies: Array<Pick<BrowserCookie, "name" | "domain" | "path">>,
  ): Promise<void>;
}

interface Entry {
  cookie?: BrowserCookie;
  version: number;
}

const keyOf = (c: Pick<BrowserCookie, "name" | "domain" | "path">) =>
  `${c.domain}\t${c.path}\t${c.name}`;

/** The parts that matter when deciding whether a cookie changed. */
const sameCookie = (a: BrowserCookie, b: BrowserCookie) =>
  a.value === b.value &&
  (a.expires ?? -1) === (b.expires ?? -1) &&
  Boolean(a.httpOnly) === Boolean(b.httpOnly) &&
  Boolean(a.secure) === Boolean(b.secure) &&
  (a.sameSite ?? "") === (b.sameSite ?? "");

/** Only the fields `Network.setCookies` accepts. */
function settable(c: BrowserCookie): BrowserCookie {
  const out: BrowserCookie = {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
  };
  if (c.sameSite) out.sameSite = c.sameSite;
  if (!c.session && typeof c.expires === "number" && c.expires > 0) out.expires = c.expires;
  return out;
}

/**
 * One set of accounts for every bot (D-032). Each screen runs its own Chromium (a profile can
 * only be open in one browser), so the signed-in state is shared through their cookies: before
 * a bot looks or acts, what any browser gained or lost since the last look goes into this jar,
 * and the bot's browser receives what it is missing. The jar is saved on the container's
 * browser volume, so sign-ins survive a restart of the container.
 */
export class SharedCookieJar {
  private readonly entries = new Map<string, Entry>();
  private version = 0;
  /** What each browser held after its last sync, to tell its own changes from ours. */
  private readonly seen = new Map<number, Map<string, BrowserCookie>>();
  /** The jar version each browser has received. */
  private readonly delivered = new Map<number, number>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly access: CookieAccess,
    private readonly file?: string,
    private readonly now: () => number = () => Date.now() / 1000,
  ) {
    this.load();
  }

  /** Brings `target` up to date with every browser in `ports` (itself included). */
  async sync(target: number, ports: number[]): Promise<void> {
    for (const port of new Set([...ports, target])) await this.collect(port);
    await this.deliver(target);
  }

  /** A browser that restarted (or a screen given to another bot) starts from nothing. */
  forget(port: number): void {
    this.seen.delete(port);
    this.delivered.delete(port);
  }

  /** Live cookies, for tests and diagnostics. */
  cookies(): BrowserCookie[] {
    return [...this.entries.values()].flatMap((e) => (e.cookie ? [e.cookie] : []));
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.save();
  }

  private async collect(port: number): Promise<void> {
    let current: BrowserCookie[];
    try {
      current = await this.access.getAll(port);
    } catch {
      return; // that browser is gone or busy; the next step tries again
    }
    const now = new Map(current.map((c) => [keyOf(c), c]));
    const before = this.seen.get(port);
    let changed = false;
    for (const [key, cookie] of now) {
      const old = before?.get(key);
      if (old && sameCookie(old, cookie)) continue;
      const entry = this.entries.get(key);
      if (!before && entry?.cookie && sameCookie(entry.cookie, cookie)) continue;
      // A browser seen for the first time only adds what the jar doesn't know yet: its stale
      // copy must not undo a sign-in or sign-out made elsewhere.
      if (!before && entry) continue;
      this.entries.set(key, { cookie, version: ++this.version });
      changed = true;
    }
    if (before) {
      for (const key of before.keys()) {
        if (now.has(key)) continue;
        const entry = this.entries.get(key);
        if (entry && !entry.cookie) continue;
        // Gone from this browser (signed out, or expired): gone for everyone.
        this.entries.set(key, { version: ++this.version });
        changed = true;
      }
    }
    this.seen.set(port, now);
    if (changed) this.scheduleSave();
  }

  private async deliver(port: number): Promise<void> {
    const since = this.delivered.get(port) ?? 0;
    const have = this.seen.get(port) ?? new Map<string, BrowserCookie>();
    const nowSec = this.now();
    const toSet: BrowserCookie[] = [];
    const toRemove: Array<Pick<BrowserCookie, "name" | "domain" | "path">> = [];
    for (const [key, entry] of this.entries) {
      if (entry.version <= since && since > 0) continue;
      const mine = have.get(key);
      if (entry.cookie) {
        const expired =
          !entry.cookie.session &&
          typeof entry.cookie.expires === "number" &&
          entry.cookie.expires > 0 &&
          entry.cookie.expires < nowSec;
        if (expired) continue;
        if (!mine || !sameCookie(mine, entry.cookie)) toSet.push(settable(entry.cookie));
      } else if (mine) {
        toRemove.push({ name: mine.name, domain: mine.domain, path: mine.path });
      }
    }
    try {
      if (toSet.length > 0) await this.access.set(port, toSet);
      if (toRemove.length > 0) await this.access.remove(port, toRemove);
    } catch {
      return; // delivered next time
    }
    this.delivered.set(port, this.version);
    // What we just gave it is not a change of its own.
    const updated = new Map(have);
    for (const c of toSet) updated.set(keyOf(c), { ...(have.get(keyOf(c)) ?? {}), ...c });
    for (const c of toRemove) updated.delete(keyOf(c));
    this.seen.set(port, updated);
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 1_000);
    this.saveTimer.unref?.();
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ cookies: this.cookies() }), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // Losing the saved copy only costs a sign-in after a restart.
    }
  }

  private load(): void {
    if (!this.file) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, "utf8")) as { cookies?: BrowserCookie[] };
      for (const cookie of saved.cookies ?? []) {
        this.entries.set(keyOf(cookie), { cookie, version: ++this.version });
      }
    } catch {
      // Nothing saved yet.
    }
  }
}
