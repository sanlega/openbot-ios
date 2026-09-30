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

describe("computer rules", () => {
  it("tell a Bot to use saved logins and ask for missing ones with a secret field", async () => {
    const { COMPUTER_RULE_BLOCK } = await import("./prompt.js");
    const flat = COMPUTER_RULE_BLOCK.replace(/\s+/g, " ");
    expect(flat).toContain("list_logins shows which do");
    expect(flat).toContain('a "secret" field for the password');
    expect(flat).toContain("save_login");
    expect(flat).toContain("Never ask for a password in chat");
    expect(flat).toContain(
      "Only a code sent to the user, a CAPTCHA or payment details also need them",
    );
  });

  it("never sends a Bot to the user for permission on ordinary steps", async () => {
    const { COMPUTER_RULE_BLOCK, NON_COS_RULE_BLOCK } = await import("./prompt.js");
    const flat = `${COMPUTER_RULE_BLOCK} ${NON_COS_RULE_BLOCK}`.replace(/\s+/g, " ");
    expect(flat).toContain("never need the user's approval");
    expect(flat).toContain("The request itself is your permission");
    expect(flat).toContain("Try at least three genuinely different approaches");
    expect(flat).not.toContain("asks the user before risky");
  });
});
