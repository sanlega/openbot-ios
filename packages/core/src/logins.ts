import type { Vault } from "./vault.js";

/**
 * Saved website logins. The owner types them once (or a Bot asks for them through a `secret` form
 * field); they live only in the vault, and the host types them into the virtual machine. The Bot
 * that needs a login only ever sees the site and the username, never the password.
 */
export const LOGIN_VAULT_PREFIX = "login.";
const SECRET_REF_PREFIX = "secret:";
/** Where answers to `secret` form fields are stored (see the inputs route). */
const FORM_SECRET_PREFIX = "input.";

export interface StoredLogin {
  username?: string;
  password?: string;
  updatedAt: string;
}

/** What may be shown to anyone: no password. */
export interface LoginSummary {
  site: string;
  username?: string;
  hasPassword: boolean;
  updatedAt: string;
}

type LoginVault = Pick<Vault, "get" | "set" | "delete" | "list">;

/** `https://www.LinkedIn.com/login?x=1` → `linkedin.com`; undefined when it isn't a hostname. */
export function siteKey(input: string): string | undefined {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : undefined;
}

/** Sign-in subdomains that may share a login with their parent domain: `accounts.example.com`. */
const SIGN_IN_LABELS = new Set([
  "www",
  "login",
  "signin",
  "accounts",
  "account",
  "auth",
  "id",
  "sso",
  "secure",
]);

/** Hosts where plain http is expected (the local desktop VM reaching this computer). */
const PLAIN_HTTP_OK = /^(localhost|host\.docker\.internal|.*\.local|.*\.internal)$/;

/**
 * Which saved sites may apply to a page: its own host, plus the parent domain only when the extra
 * labels are known sign-in ones. `evil.example.com` never gets `example.com`'s login, and a login
 * is never typed on plain http (except local test hosts).
 */
export function siteCandidates(url: string | undefined): string[] {
  if (!url) return [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && PLAIN_HTTP_OK.test(host))) {
    return [];
  }
  const labels = host.replace(/^www\./, "").split(".");
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i += 1) {
    if (i > 0 && !labels.slice(0, i).every((label) => SIGN_IN_LABELS.has(label))) break;
    out.push(labels.slice(i).join("."));
  }
  return out;
}

/**
 * Turns a `secret:` reference from an `ask_user` form into its value. Only the form answers
 * (`input.*` keys) can be referenced: never a saved login, a connector token or any other vault key.
 */
export async function resolveSecretRef(
  vault: LoginVault,
  ref: string,
): Promise<string | undefined> {
  if (!ref.startsWith(SECRET_REF_PREFIX)) return ref;
  const key = ref.slice(SECRET_REF_PREFIX.length);
  if (!key.startsWith(FORM_SECRET_PREFIX)) return undefined;
  return vault.get(key);
}

/** Saves (or updates) the login for a site. Values may be plain text or `secret:` references. */
export async function saveLogin(
  vault: LoginVault,
  site: string,
  values: { username?: string; password?: string },
  now: Date,
): Promise<{ ok: true; site: string } | { ok: false; reason: string }> {
  const key = siteKey(site);
  if (!key) return { ok: false, reason: `"${site}" isn't a website address like example.com` };
  const previous = await getLogin(vault, key);
  const username = values.username
    ? await resolveSecretRef(vault, values.username)
    : previous?.username;
  const password = values.password
    ? await resolveSecretRef(vault, values.password)
    : previous?.password;
  if (!username && !password) return { ok: false, reason: "a username or a password is needed" };
  const stored: StoredLogin = { username, password, updatedAt: now.toISOString() };
  await vault.set(`${LOGIN_VAULT_PREFIX}${key}`, JSON.stringify(stored));
  return { ok: true, site: key };
}

export async function getLogin(vault: LoginVault, site: string): Promise<StoredLogin | undefined> {
  const key = siteKey(site);
  if (!key) return undefined;
  const raw = await vault.get(`${LOGIN_VAULT_PREFIX}${key}`);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as StoredLogin;
  } catch {
    return undefined;
  }
}

/** The saved login that applies to a page URL, if any. */
export async function loginForUrl(
  vault: LoginVault,
  url: string | undefined,
): Promise<StoredLogin | undefined> {
  for (const candidate of siteCandidates(url)) {
    const login = await getLogin(vault, candidate);
    if (login) return login;
  }
  return undefined;
}

export async function listLogins(vault: LoginVault): Promise<LoginSummary[]> {
  const keys = (await vault.list()).filter((key) => key.startsWith(LOGIN_VAULT_PREFIX));
  const out: LoginSummary[] = [];
  for (const key of keys) {
    const site = key.slice(LOGIN_VAULT_PREFIX.length);
    const login = await getLogin(vault, site);
    if (login) {
      out.push({
        site,
        username: login.username,
        hasPassword: Boolean(login.password),
        updatedAt: login.updatedAt,
      });
    }
  }
  return out.sort((a, b) => a.site.localeCompare(b.site));
}

export async function removeLogin(vault: LoginVault, site: string): Promise<boolean> {
  const key = siteKey(site);
  if (!key || !(await vault.get(`${LOGIN_VAULT_PREFIX}${key}`))) return false;
  await vault.delete(`${LOGIN_VAULT_PREFIX}${key}`);
  return true;
}

/** Words that mean a field is a second factor, a repeat or a code, not the account password. */
const NOT_THE_PASSWORD =
  /confirm|repeat|retype|verif|one[- ]?time|\botp\b|2fa|\bcode\b|c[o\u00f3]digo|\bpin\b|security|new password/i;

/** Whether a field is asking for a password or for who you are, from what the page calls it. */
export function loginFieldKind(label: string, role?: string): "password" | "username" | undefined {
  const isPassword =
    role === "password" || /\bpass(word)?\b|\bcontrase((\u00f1|n))a\b/i.test(label);
  if (isPassword) return NOT_THE_PASSWORD.test(label) ? undefined : "password";
  if (/\b(e-?mail|user ?name|usuario|correo|log ?in|phone|tel[e\u00e9]fono)\b/i.test(label)) {
    return NOT_THE_PASSWORD.test(label) ? undefined : "username";
  }
  return undefined;
}
