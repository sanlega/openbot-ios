import { describe, expect, it } from "vitest";
import type { BrokerRequest } from "./broker-types.js";
import {
  builtinAskRules,
  builtinDenyReason,
  presetRules,
  resolveRules,
  ruleReason,
  SENSITIVE_COMPUTER_TARGET_RE,
  InMemoryRuleStore,
} from "./rules.js";

function req(overrides: Partial<BrokerRequest> = {}): BrokerRequest {
  return {
    botId: "bot_a",
    chainId: "chn_a",
    kind: "tool",
    action: "write_file",
    summary: "write a file",
    detail: "write a file",
    ...overrides,
  };
}

describe("builtinDenyReason (E6 built-in deny, non-overridable)", () => {
  it.each([
    ["~/.ssh/id_rsa", "credential path"],
    [".aws/credentials", "credential path"],
    ["openbot.db", "db/vault"],
    [".openbot/vault", "db/vault"],
  ])("denies %s (%s)", (target) => {
    expect(builtinDenyReason(req({ target }))).toBeDefined();
  });

  it("denies sudo regardless of target", () => {
    expect(builtinDenyReason(req({ action: "run_command", detail: "sudo rm file" }))).toBeDefined();
  });

  it("denies rm -rf only outside the workspace", () => {
    expect(
      builtinDenyReason(
        req({ action: "run_command", detail: "rm -rf /tmp/x", inWorkspace: false }),
      ),
    ).toBeDefined();
    expect(
      builtinDenyReason(
        req({ action: "run_command", detail: "rm -rf ./build", inWorkspace: true }),
      ),
    ).toBeUndefined();
  });

  it("allows an ordinary read with no built-in deny match", () => {
    expect(builtinDenyReason(req({ action: "read_file", target: "notes.txt" }))).toBeUndefined();
  });
});

describe("SENSITIVE_COMPUTER_TARGET_RE", () => {
  it.each([
    "Pay",
    "Buy now",
    "Send",
    "Delete account",
    "Transfer funds",
    "Submit order",
    "Confirm",
  ])("matches %s", (label) => {
    expect(SENSITIVE_COMPUTER_TARGET_RE.test(label)).toBe(true);
  });

  it("does not match an unrelated label", () => {
    expect(SENSITIVE_COMPUTER_TARGET_RE.test("Refresh")).toBe(false);
  });
});

describe("builtinAskRules", () => {
  it("asks for a sensitive computer target", () => {
    const rules = builtinAskRules(
      req({ kind: "computer_action", action: "click", target: "Pay now" }),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.effect).toBe("ask");
  });

  it("asks for a side-effecting connector action", () => {
    const rules = builtinAskRules(
      req({ kind: "connector_action", action: "send_email", sideEffect: true }),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.effect).toBe("ask");
  });

  it("does not ask for a non-side-effecting connector action", () => {
    expect(
      builtinAskRules(req({ kind: "connector_action", action: "list_emails", sideEffect: false })),
    ).toHaveLength(0);
  });

  it("always asks for local-machine actions", () => {
    expect(builtinAskRules(req({ kind: "local_computer", action: "open_app" }))).toHaveLength(1);
  });
});

describe("presetRules", () => {
  it("read_only denies everything via a blanket rule", () => {
    const rules = presetRules("read_only");
    const resolved = resolveRules(rules, req({ action: "anything" }));
    expect(resolved?.effect).toBe("deny");
  });

  it("workspace_write and full contribute no blanket rule", () => {
    expect(presetRules("workspace_write")).toHaveLength(0);
    expect(presetRules("full")).toHaveLength(0);
  });
});

/**
 * Rule-precedence table (plan §5 WS2 acceptance): "a deny rule beats an
 * always-allow rule", regardless of which source (builtin/preset/user)
 * contributed which rule — `resolveRules` must always pick the most severe
 * (`deny` > `ask` > `allow`) among every rule that matches.
 */
describe("resolveRules precedence (deny > ask > allow), across every combination of sources", () => {
  const userAllow = new InMemoryRuleStore().add({
    scope: "bot_a",
    match: { tool: "risky_tool" },
    effect: "allow",
    source: "user",
  });
  const userDeny = new InMemoryRuleStore().add({
    scope: "bot_a",
    match: { tool: "risky_tool" },
    effect: "deny",
    source: "user",
  });
  const builtinAsk = {
    ...userAllow,
    id: "rule_ask",
    effect: "ask" as const,
    source: "builtin" as const,
  };

  it.each([
    ["deny beats allow", [userDeny, userAllow], "deny"],
    ["deny beats ask", [userDeny, builtinAsk], "deny"],
    ["ask beats allow", [builtinAsk, userAllow], "ask"],
    ["allow alone resolves allow", [userAllow], "allow"],
    ["deny alone resolves deny", [userDeny], "deny"],
  ] as const)("%s", (_name, rules, expected) => {
    const resolved = resolveRules([...rules], req({ action: "risky_tool" }));
    expect(resolved?.effect).toBe(expected);
  });

  it("an always-allow rule never overrides a deny rule even when allow is listed first", () => {
    const resolved = resolveRules([userAllow, userDeny], req({ action: "risky_tool" }));
    expect(resolved?.effect).toBe("deny");
  });

  it("no match at all resolves undefined (falls through to the Jev risk gate)", () => {
    expect(resolveRules([userAllow, userDeny], req({ action: "unrelated_tool" }))).toBeUndefined();
  });
});

describe("ruleReason", () => {
  it("uses the stashed builtin reason when present", () => {
    const [rule] = builtinAskRules(req({ kind: "local_computer", action: "open_app" }));
    expect(ruleReason(rule!)).toContain("local-machine action");
  });

  it("gives a readable reason for a preset rule", () => {
    const [rule] = presetRules("read_only");
    expect(ruleReason(rule!)).toContain("read_only preset");
  });

  it("falls back to a generic reason when no reason was stashed", () => {
    const plainRule = {
      id: "rule_plain",
      scope: "global" as const,
      match: { tool: "foo" },
      effect: "allow" as const,
      source: "preset" as const,
      createdAt: new Date().toISOString(),
    };
    expect(ruleReason(plainRule)).toContain("permission preset");
  });
});
