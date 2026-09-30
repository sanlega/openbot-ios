import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SharedCookieJar, type BrowserCookie, type CookieAccess } from "./cookie-jar.js";

/** Browsers keyed by debug port, each a cookie store. */
function fakeBrowsers(ports: number[]) {
  const stores = new Map<number, Map<string, BrowserCookie>>(ports.map((p) => [p, new Map()]));
  const key = (c: Pick<BrowserCookie, "name" | "domain" | "path">) =>
    `${c.domain}|${c.path}|${c.name}`;
  const access: CookieAccess = {
    async getAll(port) {
      const s = stores.get(port);
      if (!s) throw new Error("gone");
      return [...s.values()].map((c) => ({ ...c }));
    },
    async set(port, cookies) {
      for (const c of cookies) stores.get(port)!.set(key(c), { ...c });
    },
    async remove(port, cookies) {
      for (const c of cookies) stores.get(port)!.delete(key(c));
    },
  };
  const login = (port: number, value = "token-1", name = "session", domain = ".example.com") =>
    stores.get(port)!.set(key({ name, domain, path: "/" }), {
      name,
      value,
      domain,
      path: "/",
      expires: 4_000_000_000,
      secure: true,
      httpOnly: true,
    });
  const logout = (port: number, name = "session", domain = ".example.com") =>
    stores.get(port)!.delete(key({ name, domain, path: "/" }));
  const value = (port: number, name = "session") =>
    [...stores.get(port)!.values()].find((c) => c.name === name)?.value;
  return { access, stores, login, logout, value };
}

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("SharedCookieJar", () => {
  it("a sign-in on one bot's screen reaches another bot's screen", async () => {
    const b = fakeBrowsers([9001, 9002]);
    const jar = new SharedCookieJar(b.access);
    await jar.sync(9001, [9001, 9002]);
    await jar.sync(9002, [9001, 9002]);
    b.login(9001);
    await jar.sync(9002, [9001, 9002]);
    expect(b.value(9002)).toBe("token-1");
  });

  it("a sign-out on one screen signs the other screens out too", async () => {
    const b = fakeBrowsers([9001, 9002]);
    const jar = new SharedCookieJar(b.access);
    b.login(9001);
    await jar.sync(9002, [9001, 9002]);
    expect(b.value(9002)).toBe("token-1");
    await jar.sync(9001, [9001, 9002]);
    b.logout(9002);
    await jar.sync(9001, [9001, 9002]);
    expect(b.value(9001)).toBeUndefined();
  });

  it("a refreshed session token wins over the old copy", async () => {
    const b = fakeBrowsers([9001, 9002]);
    const jar = new SharedCookieJar(b.access);
    b.login(9001, "old");
    await jar.sync(9002, [9001, 9002]);
    await jar.sync(9001, [9001, 9002]);
    b.login(9002, "new");
    await jar.sync(9001, [9001, 9002]);
    expect(b.value(9001)).toBe("new");
  });

  it("a browser seen for the first time cannot undo newer state with its stale profile", async () => {
    const b = fakeBrowsers([9001, 9002]);
    const jar = new SharedCookieJar(b.access);
    b.login(9001, "fresh");
    await jar.sync(9001, [9001]);
    b.login(9002, "stale");
    await jar.sync(9002, [9001, 9002]);
    expect(b.value(9002)).toBe("fresh");
    expect(b.value(9001)).toBe("fresh");
  });

  it("keeps sign-ins across a container restart through its saved file", async () => {
    dir = mkdtempSync(join(tmpdir(), "openbot-jar-"));
    const file = join(dir, "cookies.json");
    const b = fakeBrowsers([9001]);
    const jar = new SharedCookieJar(b.access, file);
    b.login(9001);
    await jar.sync(9001, [9001]);
    jar.flush();

    const after = fakeBrowsers([9005]);
    const restarted = new SharedCookieJar(after.access, file);
    await restarted.sync(9005, [9005]);
    expect(after.value(9005)).toBe("token-1");
  });

  it("does not hand out expired cookies, and a browser that is gone is skipped", async () => {
    const b = fakeBrowsers([9001, 9002]);
    const jar = new SharedCookieJar(b.access, undefined, () => 5_000_000_000);
    b.login(9001);
    await jar.sync(9002, [9001, 9002, 9999]);
    expect(b.value(9002)).toBeUndefined();
  });
});
