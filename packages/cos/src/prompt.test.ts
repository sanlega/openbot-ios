import { describe, expect, it } from "vitest";
import { buildCosSystemPrompt, buildNonCosRuleBlock } from "./prompt.js";
import { DEFAULT_AUTONOMY_CAPS } from "./caps.js";

/** The conservative limits these tests are about; the shipped defaults are looser so the Chief can delegate freely. */
const STRICT_CAPS = {
  ...DEFAULT_AUTONOMY_CAPS,
  cosCreatedBotsMax: 6,
  newBotsPerDay: 2,
  spawnCooldownMin: 30,
};

describe("CoS system prompt", () => {
  it("includes the answer/do/delegate/spawn ladder", () => {
    const prompt = buildCosSystemPrompt({
      userName: "Alice",
      roster: [],
      caps: STRICT_CAPS,
      cosCreatedBotCount: 1,
      spawnsLeftToday: 2,
    });
    const flat = prompt.replace(/\s+/g, " ");
    expect(flat).toContain("You are the dispatcher");
    expect(flat).toContain("Delegating is the default");
    expect(flat).toContain("Answer it yourself only if it is quick");
    expect(flat).toContain("goes to a bot with send_message");
    expect(flat).toContain("create one with create_bot without asking the user");
    expect(flat).toContain("One-off jobs are fine");
    expect(flat).not.toContain("One-off tasks NEVER get a new bot");
    expect(flat).toContain("If you are unsure whether to delegate: delegate.");
  });

  it("fills roster and limits placeholders", () => {
    const prompt = buildCosSystemPrompt({
      userName: "Bob",
      roster: [
        {
          id: "b1",
          slug: "inbox",
          name: "Inbox Bot",
          description: "Handles email",
          createdBy: "user",
          routing: { mode: "auto" },
          permissionPreset: "workspace_write",
          computer: "none",
          connectors: [],
          limits: {},
          pinned: false,
          hidden: false,
          isChiefOfStaff: false,
        },
      ],
      caps: STRICT_CAPS,
      cosCreatedBotCount: 2,
      spawnsLeftToday: 1,
    });
    expect(prompt).toContain("Inbox Bot");
    expect(prompt).toContain("2/6 bots");
    expect(prompt).toContain("1 new bots");
  });

  it("non-CoS rule block forbids create_bot", () => {
    const block = buildNonCosRuleBlock(4);
    expect(block).toContain("cannot create bots");
    expect(block).toContain("4 hours");
  });
});
