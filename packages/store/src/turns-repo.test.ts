import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { TurnsRepo } from "./turns-repo.js";

let close: (() => void) | undefined;
afterEach(() => {
  close?.();
  close = undefined;
});

describe("TurnsRepo.listOpen", () => {
  it("returns queued and running turns only", () => {
    const opened = openDb({ path: ":memory:" });
    close = opened.close;
    const repo = new TurnsRepo(opened.db);
    const base = {
      botId: "bot_1",
      chainId: "chn_1",
      engine: "codex" as const,
      model: "m",
      status: "queued" as const,
      usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    repo.create({ ...base, id: "turn_open" } as never);
    repo.create({ ...base, id: "turn_done" } as never);
    repo.updateStatus("turn_done", "completed");
    expect(repo.listOpen().map((t) => t.id)).toEqual(["turn_open"]);
    repo.updateStatus("turn_open", "interrupted");
    expect(repo.listOpen()).toEqual([]);
  });
});
