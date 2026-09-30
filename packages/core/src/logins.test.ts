import { describe, expect, it } from "vitest";
import {
  listLogins,
  loginFieldKind,
  loginForUrl,
  removeLogin,
  resolveSecretRef,
  saveLogin,
  siteCandidates,
  siteKey,
} from "./logins.js";
import { InMemoryVault } from "./vault.js";

const NOW = new Date("2026-09-30T10:00:00Z");

describe("saved logins", () => {
  it("normalizes a site to its host", () => {
    expect(siteKey("https://www.LinkedIn.com/login?x=1")).toBe("linkedin.com");
    expect(siteKey("linkedin.com")).toBe("linkedin.com");
    expect(siteKey("not a site")).toBeUndefined();
    expect(siteKey("localhost")).toBeUndefined();
  });

  it("tries a page's host and then its parent domains", () => {
    expect(siteCandidates("https://accounts.www.example.com/login")).toEqual([
      "accounts.www.example.com",
      "www.example.com",
      "example.com",
    ]);
    expect(siteCandidates("https://www.example.com/")).toEqual(["example.com"]);
    expect(siteCandidates(undefined)).toEqual([]);
  });

  it("stores a login, finds it for any page of the site, and never lists the password", async () => {
    const vault = new InMemoryVault();
    const saved = await saveLogin(
      vault,
      "https://www.example.com",
      {
        username: "me@example.com",
        password: "hunter2",
      },
      NOW,
    );
    expect(saved).toEqual({ ok: true, site: "example.com" });

    const found = await loginForUrl(vault, "https://accounts.example.com/signin");
    expect(found).toMatchObject({ username: "me@example.com", password: "hunter2" });

    const listed = await listLogins(vault);
    expect(listed).toEqual([
      {
        site: "example.com",
        username: "me@example.com",
        hasPassword: true,
        updatedAt: NOW.toISOString(),
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain("hunter2");
  });

  it("resolves secret: references from the vault when saving", async () => {
    const vault = new InMemoryVault();
    await vault.set("input.abc.password", "s3cret");
    const saved = await saveLogin(
      vault,
      "example.com",
      { username: "me", password: "secret:input.abc.password" },
      NOW,
    );
    expect(saved.ok).toBe(true);
    expect((await loginForUrl(vault, "https://example.com"))?.password).toBe("s3cret");
    expect(await resolveSecretRef(vault, "secret:input.abc.password")).toBe("s3cret");
    expect(await resolveSecretRef(vault, "plain text")).toBe("plain text");
  });

  it("keeps the old password when only the username changes", async () => {
    const vault = new InMemoryVault();
    await saveLogin(vault, "example.com", { username: "a", password: "pw" }, NOW);
    await saveLogin(vault, "example.com", { username: "b" }, NOW);
    expect(await loginForUrl(vault, "https://example.com")).toMatchObject({
      username: "b",
      password: "pw",
    });
  });

  it("rejects an invalid site and an empty login", async () => {
    const vault = new InMemoryVault();
    expect((await saveLogin(vault, "nope", { username: "a" }, NOW)).ok).toBe(false);
    expect((await saveLogin(vault, "example.com", {}, NOW)).ok).toBe(false);
  });

  it("removes a login", async () => {
    const vault = new InMemoryVault();
    await saveLogin(vault, "example.com", { username: "a" }, NOW);
    expect(await removeLogin(vault, "example.com")).toBe(true);
    expect(await removeLogin(vault, "example.com")).toBe(false);
    expect(await listLogins(vault)).toEqual([]);
  });

  it.each([
    ["Password", undefined, "password"],
    ["Contraseña", undefined, "password"],
    ["anything", "password", "password"],
    ["Email or phone", undefined, "username"],
    ["Usuario", undefined, "username"],
    ["Search", undefined, undefined],
  ])("classifies the field %s (%s) as %s", (label, role, kind) => {
    expect(loginFieldKind(label, role)).toBe(kind);
  });
});

describe("saved logins: what they may be used for", () => {
  it("does not offer example.com's login to evil.example.com, or to plain http", () => {
    expect(siteCandidates("https://evil.example.com/login")).toEqual(["evil.example.com"]);
    expect(siteCandidates("https://accounts.example.com/login")).toEqual([
      "accounts.example.com",
      "example.com",
    ]);
    expect(siteCandidates("http://example.com/login")).toEqual([]);
    // The local VM reaching this computer for tests is the one plain-http exception.
    expect(siteCandidates("http://host.docker.internal:9911/login")).toEqual([
      "host.docker.internal",
    ]);
  });

  it("only resolves secret: references that point at a form answer, never another vault key", async () => {
    const vault = new InMemoryVault();
    await vault.set("input.f1.pw", "form-answer");
    await vault.set("login.bank.com", JSON.stringify({ username: "u", password: "bank-password" }));
    await vault.set("connector.github.token", "ghp_secret");
    expect(await resolveSecretRef(vault, "secret:input.f1.pw")).toBe("form-answer");
    expect(await resolveSecretRef(vault, "secret:login.bank.com")).toBeUndefined();
    expect(await resolveSecretRef(vault, "secret:connector.github.token")).toBeUndefined();

    // ...and so a Bot cannot copy one saved login into another through save_login.
    const copied = await saveLogin(
      vault,
      "attacker.example",
      { username: "x", password: "secret:login.bank.com" },
      NOW,
    );
    expect(copied.ok).toBe(true);
    expect((await loginForUrl(vault, "https://attacker.example"))?.password).toBeUndefined();
  });

  it.each([
    ["Confirm password", undefined],
    ["Verification code", undefined],
    ["Security code", undefined],
    ["Enter your PIN", undefined],
    ["New password", undefined],
    ["Search", undefined],
    ["Telephone book", undefined],
  ])("does not treat %s as the login", (label, role) => {
    expect(loginFieldKind(label, role)).toBeUndefined();
  });
});
