import { describe, expect, it } from "vitest";
import { assembleSystemPrompt, NON_COS_RULE_BLOCK, SHARED_COMPUTER_NOTICE } from "./prompt.js";

describe("assembleSystemPrompt (plan §5 WS2: Bot description + non-CoS rule block + shared-computer notice)", () => {
  it("gives the Chief of Staff only its own description (no non-CoS rule block)", () => {
    const prompt = assembleSystemPrompt({
      botDescription: "You are the Chief of Staff.",
      isChiefOfStaff: true,
      hasComputerAccess: false,
    });
    expect(prompt).toContain("You are the Chief of Staff.");
    expect(prompt).not.toContain(NON_COS_RULE_BLOCK);
    expect(prompt).not.toContain(SHARED_COMPUTER_NOTICE);
  });

  it("gives every other Bot the non-CoS rule block, including the 'cannot create bots' line", () => {
    const prompt = assembleSystemPrompt({
      botDescription: "You are a research assistant.",
      isChiefOfStaff: false,
      hasComputerAccess: false,
    });
    expect(prompt).toContain(NON_COS_RULE_BLOCK);
    expect(prompt).toContain("You cannot create bots.");
    expect(prompt).not.toContain(SHARED_COMPUTER_NOTICE);
  });

  it("adds the shared-computer notice only when the Bot has computer access", () => {
    const prompt = assembleSystemPrompt({
      botDescription: "You browse the web.",
      isChiefOfStaff: false,
      hasComputerAccess: true,
    });
    expect(prompt).toContain(SHARED_COMPUTER_NOTICE);
  });
});
