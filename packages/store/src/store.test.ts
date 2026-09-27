import { describe, expect, it, afterEach } from "vitest";
import { newId } from "@openbot/contracts";
import type { Bot } from "@openbot/contracts";
import { openDb, type Db } from "./db.js";
import { EventStore } from "./event-store.js";
import { BotsRepo } from "./bots-repo.js";
import type Database from "better-sqlite3";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function useDb(): { db: Db; sqlite: Database.Database } {
  const { db, sqlite, close } = openDb({ path: ":memory:" });
  cleanup = close;
  return { db, sqlite };
}

describe("openDb", () => {
  it("runs migrations against an in-memory database without error", () => {
    const { sqlite } = useDb();
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("bots");
    expect(names).toContain("events");
    expect(names).toContain("decisions");
  });
});

describe("EventStore", () => {
  it("appends events and assigns a monotonic seq", () => {
    const { db } = useDb();
    const store = new EventStore(db);

    const first = store.append({
      ts: new Date().toISOString(),
      type: "bot.created",
      botId: "bot_1",
      payload: { slug: "assistant" },
    });
    const second = store.append({
      ts: new Date().toISOString(),
      type: "bot.created",
      botId: "bot_2",
      payload: { slug: "researcher" },
    });

    expect(first.seq).toBeLessThan(second.seq);
    expect(store.count()).toBe(2);
  });

  it("replays events since a given seq (exclusive), preserving order", () => {
    const { db } = useDb();
    const store = new EventStore(db);
    const events = [1, 2, 3].map((n) =>
      store.append({
        ts: new Date().toISOString(),
        type: "bot.created",
        payload: { n },
      }),
    );
    const [first, second, third] = events;
    if (!first || !second || !third) throw new Error("expected 3 appended events");

    const replayed = store.listSince(first.seq);
    expect(replayed.map((e) => e.seq)).toEqual([second.seq, third.seq]);
  });

  it("round-trips id, type, and payload through getBySeq", () => {
    const { db } = useDb();
    const store = new EventStore(db);
    const appended = store.append({
      ts: new Date().toISOString(),
      type: "message.created",
      threadId: "thread_1",
      payload: { text: "hi" },
    });

    const fetched = store.getBySeq(appended.seq);
    expect(fetched).toEqual(appended);
    expect(fetched?.id).toBe(appended.id);
  });

  it("auto-generates an id when none is supplied", () => {
    const { db } = useDb();
    const store = new EventStore(db);
    const appended = store.append({
      ts: new Date().toISOString(),
      type: "bot.created",
      payload: {},
    });
    expect(appended.id.startsWith("evt_")).toBe(true);
  });
});

describe("BotsRepo", () => {
  const sampleBot = (): Bot => ({
    id: newId("bot"),
    slug: "assistant",
    name: "Assistant",
    description: "General-purpose helper bot.",
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "user",
    routing: { mode: "auto" },
    permissionPreset: "workspace_write",
    computer: "none",
    connectors: [],
    limits: { dailyUsd: 5, dailyTokens: undefined },
  });

  it("creates a bot and reads it back by id", () => {
    const { db } = useDb();
    const repo = new BotsRepo(db);
    const bot = sampleBot();

    repo.create(bot);
    const fetched = repo.getById(bot.id);

    expect(fetched).toBeDefined();
    expect(fetched?.slug).toBe("assistant");
    expect(fetched?.routing).toEqual({ mode: "auto" });
    expect(fetched?.limits.dailyUsd).toBe(5);
    expect(fetched?.limits.dailyTokens).toBeUndefined();
  });

  it("lists all created bots", () => {
    const { db } = useDb();
    const repo = new BotsRepo(db);
    const a = sampleBot();
    const b = { ...sampleBot(), id: newId("bot"), slug: "researcher", name: "Researcher" };

    repo.create(a);
    repo.create(b);

    const listed = repo.list();
    expect(listed.map((bot) => bot.slug).sort()).toEqual(["assistant", "researcher"]);
  });

  it("returns undefined for an unknown id", () => {
    const { db } = useDb();
    const repo = new BotsRepo(db);
    expect(repo.getById(newId("bot"))).toBeUndefined();
  });
});
