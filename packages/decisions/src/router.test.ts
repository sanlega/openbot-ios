import { describe, expect, it } from "vitest";
import type { Bot } from "@openbot/contracts";
import { buildRouteState } from "./router.js";

const bot: Bot = {
  id: "bot_1",
  slug: "assistant",
  name: "Assistant",
  description: "General helper",
  pinned: false,
  hidden: false,
  isChiefOfStaff: false,
  createdBy: "user",
  routing: { mode: "auto" },
  permissionPreset: "workspace_write",
  computer: "none",
  connectors: [],
  limits: {},
};

describe("buildRouteState", () => {
  it("omits currentEngine/currentEngineIdleMinutes when there's no active session", () => {
    const state = buildRouteState(bot, "do a thing", {
      availableEngines: ["claude", "codex"],
      modelsCatalog: { claude: ["sonnet"], codex: ["gpt-5"] },
    });
    expect(state.currentEngine).toBeUndefined();
    expect(state.currentEngineIdleMinutes).toBeUndefined();
  });

  it("carries the Bot's currently active engine and how long it's been idle", () => {
    const state = buildRouteState(bot, "continue", {
      availableEngines: ["claude", "codex"],
      modelsCatalog: { claude: ["sonnet"], codex: ["gpt-5"] },
      currentEngine: "codex",
      currentEngineIdleMinutes: 2,
    });
    expect(state.currentEngine).toBe("codex");
    expect(state.currentEngineIdleMinutes).toBe(2);
  });
});
