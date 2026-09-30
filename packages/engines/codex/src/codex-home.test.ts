import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexHome } from "./codex-home.js";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

const auth = (token: string, refreshedAt: string) =>
  JSON.stringify({ tokens: { access_token: token }, last_refresh: refreshedAt });

async function setup() {
  root = await mkdtemp(join(tmpdir(), "ob-codexhome-"));
  const owner = join(root, "owner");
  const dir = join(root, "openbot", "codex-home");
  await mkdir(owner, { recursive: true });
  // The owner's own Codex config: plugins, MCP servers and a policy that must not leak.
  await writeFile(
    join(owner, "config.toml"),
    'approval_policy = "never"\n[mcp_servers.cua_repl]\ncommand = "x"\n[plugins."sites@bundled"]\nenabled = true\n',
  );
  await writeFile(join(owner, "AGENTS.md"), "the owner's personal instructions");
  await writeFile(join(owner, "auth.json"), auth("owner-1", "2026-09-30T10:00:00Z"));
  return { owner, dir, home: new CodexHome(dir, owner) };
}

const read = (...parts: string[]) => readFile(join(...parts), "utf8");

describe("CodexHome", () => {
  it("brings only the login into the private home, none of the owner's config", async () => {
    const { dir, home } = await setup();
    expect(await home.prepare()).toEqual({ hasLogin: true });
    expect(await read(dir, "auth.json")).toContain("owner-1");
    const config = await read(dir, "config.toml");
    expect(config).toContain('cli_auth_credentials_store = "file"');
    // Without this Codex loads the owner's ~/.codex as the "project" of a workspace under their home.
    expect(config).toContain("project_root_markers");
    for (const leaked of ["cua_repl", "sites@bundled", "never"]) {
      expect(config).not.toContain(leaked);
    }
    await expect(stat(join(dir, "AGENTS.md"))).rejects.toThrow();
  });

  it("copies a login refreshed in the private home back to the owner's", async () => {
    const { owner, dir, home } = await setup();
    await home.prepare();
    await writeFile(join(dir, "auth.json"), auth("refreshed", "2026-09-30T11:00:00Z"));
    await home.sync();
    expect(await read(owner, "auth.json")).toContain("refreshed");
  });

  it("copies a newer owner login (they signed in again) into the private home", async () => {
    const { owner, dir, home } = await setup();
    await home.prepare();
    await writeFile(join(owner, "auth.json"), auth("owner-2", "2026-09-30T12:00:00Z"));
    await home.sync();
    expect(await read(dir, "auth.json")).toContain("owner-2");
  });

  it("decides by when the login was refreshed, not by file times, so the two never ping-pong", async () => {
    const { owner, dir, home } = await setup();
    await home.prepare();
    // Same login in both: repeated syncs change nothing (a file-time rule rewrote it every minute).
    const before = (await stat(join(owner, "auth.json"))).mtimeMs;
    await home.sync();
    await home.sync();
    expect((await stat(join(owner, "auth.json"))).mtimeMs).toBe(before);
    // An older login never overwrites a newer one, whatever the files' times say.
    await writeFile(join(dir, "auth.json"), auth("stale", "2026-09-30T09:00:00Z"));
    await home.sync();
    expect(await read(owner, "auth.json")).toContain("owner-1");
    expect(await read(dir, "auth.json")).toContain("owner-1");
  });

  it("does not bring a signed-out owner's login back: signing out of Codex signs OpenBot out too", async () => {
    const { owner, dir, home } = await setup();
    await home.prepare();
    await rm(join(owner, "auth.json"));
    await home.sync();
    await expect(stat(join(dir, "auth.json"))).rejects.toThrow();
    await expect(stat(join(owner, "auth.json"))).rejects.toThrow();
  });

  it("reports no login when the owner has none (API-key users, or a login kept in the OS keyring)", async () => {
    root = await mkdtemp(join(tmpdir(), "ob-codexhome-"));
    const home = new CodexHome(join(root, "home"), join(root, "nobody"));
    expect(await home.prepare()).toEqual({ hasLogin: false });
    await expect(stat(join(root, "home", "auth.json"))).rejects.toThrow();
  });

  it("does not read a locked or half-written owner login as a sign-out", async () => {
    const { owner, dir, home } = await setup();
    await home.prepare();
    // A directory where the file should be: reading it fails with something other than "missing".
    await rm(join(owner, "auth.json"));
    await mkdir(join(owner, "auth.json"));
    await home.sync();
    expect(await read(dir, "auth.json")).toContain("owner-1");
  });
});
