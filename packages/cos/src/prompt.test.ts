import { describe, expect, it } from "vitest";
import { buildCosSystemPrompt, buildNonCosRuleBlock } from "./prompt.js";
import { DEFAULT_AUTONOMY_CAPS } from "./caps.js";

describe("CoS system prompt", () => {
  it("includes the answer/do/delegate/spawn ladder", () => {
    const prompt = buildCosSystemPrompt({
      userName: "Alice",
      roster: [],
      caps: DEFAULT_AUTONOMY_CAPS,
      cosCreatedBotCount: 1,
      spawnsLeftToday: 2,
    });
    expect(prompt).toContain("FEWEST bots and the FEWEST interruptions");
    expect(prompt).toContain("Answer it yourself");
    expect(prompt).toContain("Do the work yourself");
    expect(prompt).toContain("Delegate it with send_message");
    expect(prompt).toContain("consider create_bot");
    expect(prompt).toContain("One-off tasks NEVER get a new bot");
    expect(prompt).toContain("If you are unsure whether something justifies");
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
      caps: DEFAULT_AUTONOMY_CAPS,
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
