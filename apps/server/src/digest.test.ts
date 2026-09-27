import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newId, type Bot } from "@openbot/contracts";
import { createCoreContext, loadConfig, type CoreContext } from "@openbot/core";
import { DEFAULT_AUTONOMY_CAPS } from "@openbot/cos";
import { FakeClock } from "@openbot/testkit";
import { postDigestIfDue } from "./digest.js";

let ctx: CoreContext | undefined;
let home: string | undefined;

afterEach(async () => {
  ctx?.closeDb();
  if (home) await rm(home, { recursive: true, force: true });
  ctx = undefined;
  home = undefined;
});

function bot(overrides: Partial<Bot>): Bot {
  return {
    id: newId("bot"),
    slug: `b-${Math.random().toString(36).slice(2, 7)}`,
    name: "Bot",
    description: "d",
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    routing: { mode: "auto" },
    permissionPreset: "workspace_write",
    computer: "none",
    connectors: [],
    limits: {},
    ...overrides,
  };
}

async function setup() {
  home = await mkdtemp(join(tmpdir(), "openbot-digest-"));
  // 17:30 local time, the day of the test data.
  const clock = new FakeClock(new Date(2026, 8, 27, 17, 30));
  ctx = await createCoreContext({
    clock,
    config: loadConfig({ env: { OPENBOT_HOME: home }, overrides: { dbPath: ":memory:" } }),
    disableNdjson: true,
  });
  const core = ctx;
  const addBot = (b: Bot) => {
    core.repos.bots.create(b);
    const threadId = newId("thread");
    core.repos.threads.create({
      id: threadId,
      botId: b.id,
      kind: "dm",
      createdAt: clock.now().toISOString(),
    });
    return threadId;
  };
  const cos = bot({ name: "Chief", isChiefOfStaff: true });
  const cosThread = addBot(cos);
  const researcher = bot({ name: "Researcher" });
  const researcherThread = addBot(researcher);
  core.repos.messages.create({
    id: newId("message"),
    threadId: researcherThread,
    author: { type: "bot", id: researcher.id },
    text: "still looking at flights...",
    attachments: [],
    hop: 0,
    createdAt: clock.now().toISOString(),
    proactive: true,
    kind: "result",
    delivery: "held",
    pushed: false,
  });
  return { core, clock, cosThread };
}

describe("postDigestIfDue", () => {
  it("posts one CoS message at the digest hour listing held messages, once per day", async () => {
    const { core, clock, cosThread } = await setup();

    expect(await postDigestIfDue(core, DEFAULT_AUTONOMY_CAPS)).toBeUndefined();

    clock.advance(31 * 60_000); // 18:01, the default digest hour
    const posted = await postDigestIfDue(core, DEFAULT_AUTONOMY_CAPS);
    expect(posted?.threadId).toBe(cosThread);
    expect(posted?.text).toContain("Held messages:");
    expect(posted?.text).toContain("Researcher: still looking at flights...");

    clock.advance(10 * 60_000);
    expect(await postDigestIfDue(core, DEFAULT_AUTONOMY_CAPS)).toBeUndefined();
    expect(core.repos.messages.list({ threadId: cosThread })).toHaveLength(1);
  });

  it("only lists what was held since the previous digest", async () => {
    const { core, clock } = await setup();
    clock.advance(31 * 60_000);
    await postDigestIfDue(core, DEFAULT_AUTONOMY_CAPS);

    clock.advance(24 * 60 * 60_000);
    const next = await postDigestIfDue(core, DEFAULT_AUTONOMY_CAPS);
    expect(next?.text).not.toContain("still looking at flights");
    expect(next?.text).toContain("Nothing to report today.");
  });
});
