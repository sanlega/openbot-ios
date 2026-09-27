import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { newId, type Routine } from "@openbot/contracts";
import { allowedWatchRoots, resolveWatchPath } from "./file-watch-paths.js";

function makeCtx(home: string) {
  const botId = newId("bot");
  return {
    config: {
      workspaceDir: resolve(home, "workspace"),
      screensDir: resolve(home, "screens"),
    },
    botId,
  };
}

function fileRoutine(botId: string, path?: string): Routine {
  return {
    id: newId("routine"),
    botId,
    name: "file watch",
    prompt: "react",
    createdBy: "user",
    enabled: true,
    liveApproved: false,
    trigger: { type: "event", source: "file", path },
    limits: {
      perRun: { usd: 1, tokens: 1000, turns: 5, computerSteps: 0, wallMin: 10 },
      dailyUsd: 5,
      maxRunsPerDay: 24,
      cooldownSec: 60,
    },
    consecutiveFailures: 0,
    createdAt: new Date().toISOString(),
  };
}

describe("resolveWatchPath", () => {
  it("allows paths under the shared workspace", () => {
    const home = resolve("data");
    const { config, botId } = makeCtx(home);
    const routine = fileRoutine(botId, "inbox/*.json");
    const resolved = resolveWatchPath({ config } as never, routine, "inbox/*.json");
    expect(resolved).toBe(resolve(home, "workspace", "inbox", "*.json"));
  });

  it("allows paths under the bot screen directory via screens/ prefix", () => {
    const home = resolve("data");
    const { config, botId } = makeCtx(home);
    const routine = fileRoutine(botId, "screens/captures");
    const resolved = resolveWatchPath({ config } as never, routine, "screens/captures");
    expect(resolved).toBe(resolve(home, "screens", botId, "captures"));
  });

  it("rejects paths that escape allowed roots", () => {
    const { config, botId } = makeCtx(resolve("data"));
    const routine = fileRoutine(botId, "../../../etc/passwd");
    expect(resolveWatchPath({ config } as never, routine, "../../../etc/passwd")).toBeUndefined();
  });

  it("lists shared workspace and bot screen roots", () => {
    const home = resolve("data");
    const { config, botId } = makeCtx(home);
    expect(allowedWatchRoots({ config } as never, botId)).toEqual([
      resolve(home, "workspace"),
      resolve(home, "screens", botId),
    ]);
  });
});
