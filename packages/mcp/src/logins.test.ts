import { afterEach, describe, expect, it } from "vitest";
import { OPENBOT_TOOL_DEFINITIONS } from "./tool-definitions.js";
import { createMcpTestHarness, issueToken, makeBot } from "./test-helpers.js";

let harness: Awaited<ReturnType<typeof createMcpTestHarness>> | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

async function call(
  h: NonNullable<typeof harness>,
  bot: ReturnType<typeof makeBot>,
  tool: string,
  payload: Record<string, unknown> = {},
) {
  const res = await h.app.inject({
    method: "POST",
    url: `/internal/tools/${tool}`,
    headers: { "x-openbot-session": issueToken(h, bot) },
    payload,
  });
  return res.json<Record<string, unknown>>();
}

describe("login tools", () => {
  it("offer listing and adding a login, but not removing one (only the owner does that)", () => {
    const names = OPENBOT_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_logins", "save_login"]));
    expect(names).not.toContain("forget_login");
  });

  it("save a login from a secret reference and list it without the password", async () => {
    harness = await createMcpTestHarness();
    const h = harness;
    const bot = makeBot({ name: "Worker", slug: "worker" });
    h.ctx.repos.bots.create(bot);
    // What answering an ask_user secret field leaves in the vault.
    await h.ctx.vault.set("input.form1.password", "correct horse");

    expect(await call(h, bot, "list_logins")).toMatchObject({ allowed: true, logins: [] });

    const saved = await call(h, bot, "save_login", {
      site: "https://www.example.com/login",
      username: "me@example.com",
      password: "secret:input.form1.password",
    });
    expect(saved).toMatchObject({ allowed: true, saved: true, site: "example.com" });

    const listed = await call(h, bot, "list_logins");
    expect(listed).toMatchObject({
      allowed: true,
      logins: [{ site: "example.com", username: "me@example.com", hasPassword: true }],
    });
    expect(JSON.stringify(listed)).not.toContain("correct horse");
    expect(JSON.stringify(saved)).not.toContain("correct horse");
  });

  it("refuse to overwrite a saved login: a Bot can add one, never replace the owner's", async () => {
    harness = await createMcpTestHarness();
    const h = harness;
    const bot = makeBot({ name: "Worker", slug: "worker" });
    h.ctx.repos.bots.create(bot);
    await h.ctx.vault.set("input.form1.password", "the real one");
    await call(h, bot, "save_login", {
      site: "bank.example",
      username: "owner",
      password: "secret:input.form1.password",
    });

    const attempt = await call(h, bot, "save_login", {
      site: "bank.example",
      username: "attacker",
      password: "hunter2",
    });
    expect(attempt).toMatchObject({ allowed: false });
    expect(JSON.stringify(await call(h, bot, "list_logins"))).toContain("owner");
    expect(JSON.stringify(await call(h, bot, "list_logins"))).not.toContain("attacker");
  });

  it("cannot copy one saved login into another through a secret: reference", async () => {
    harness = await createMcpTestHarness();
    const h = harness;
    const bot = makeBot({ name: "Worker", slug: "worker" });
    h.ctx.repos.bots.create(bot);
    await h.ctx.vault.set(
      "login.bank.example",
      JSON.stringify({ username: "owner", password: "bank-password" }),
    );

    await call(h, bot, "save_login", {
      site: "attacker.example",
      username: "x",
      password: "secret:login.bank.example",
    });
    const stored = await h.ctx.vault.get("login.attacker.example");
    expect(stored ?? "").not.toContain("bank-password");
  });

  it("refuse a site that is not a website address", async () => {
    harness = await createMcpTestHarness();
    const bot = makeBot({ name: "Worker", slug: "worker" });
    harness.ctx.repos.bots.create(bot);
    expect(await call(harness, bot, "save_login", { site: "nope", username: "a" })).toMatchObject({
      allowed: false,
    });
  });
});
