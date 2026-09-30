import { describe, expect, it } from "vitest";
import type { Action, DecisionService, Observation, Screen } from "@openbot/contracts";
import { runFastLoop, classifyBlocker, type ComputerStepEvent } from "./fast-loop.js";

/** A page: its elements and where a click on an element (by label) leads. */
interface Page {
  observation: Observation;
  leadsTo?: Record<string, string>;
  /** Labels whose click reports an error the first time. */
  failsOnce?: string[];
}

function page(url: string, title: string, labels: Array<[string, string]>): Observation {
  return {
    url,
    title,
    elements: labels.map(([role, label], index) => ({ index, role, label })),
  };
}

function siteStub(pages: Record<string, Page>, start: string) {
  let current = start;
  const acts: Action[] = [];
  const failed = new Set<string>();
  const takeovers: boolean[] = [];
  const screen: Screen = {
    observe: async () => pages[current]!.observation,
    act: async (action) => {
      acts.push(action);
      if (action.op !== "click" || action.target === undefined) return { ok: true };
      const label = pages[current]!.observation.elements[action.target]?.label ?? "";
      if (pages[current]!.failsOnce?.includes(label) && !failed.has(label)) {
        failed.add(label);
        return { ok: false, reason: "element detached" };
      }
      const next = pages[current]!.leadsTo?.[label];
      if (next) current = next;
      return { ok: true };
    },
    liveView: async () => ({ url: "", token: "", expiresAt: "" }),
    takeover: async (on) => {
      takeovers.push(on);
    },
  };
  return {
    screen,
    acts,
    takeovers,
    goTo: (name: string) => {
      current = name;
    },
  };
}

/** Picks the first option in `prefer` order that is offered; `unsure` spreads the odds thin. */
function jev(
  prefer: (offered: string[], descriptions: Record<string, string>) => string,
  options: {
    unsure?: (descriptions: Record<string, string>) => boolean;
    offered?: string[][];
    destructive?: number;
  } = {},
): DecisionService {
  return {
    decide: async (req: { questions: Record<string, { criteria: Record<string, string> }> }) => {
      const descriptions = req.questions.action!.criteria;
      const offered = Object.keys(descriptions);
      options.offered?.push(offered);
      const choice = prefer(offered, descriptions);
      const unsure = options.unsure?.(descriptions) ?? false;
      const probabilities: Record<string, number> = unsure
        ? { [choice]: 0.2, wait: 0.15, scroll_down: 0.1 }
        : { [choice]: 0.95 };
      return {
        answers: {
          action: {
            type: "choice",
            choice,
            confidence: unsure ? 0.2 : 0.95,
            probabilities,
          },
          is_destructive: { type: "noul", noul: options.destructive ?? 0.02 },
        },
        provider: "jev",
        model: "test",
        latencyMs: 1,
        decisionId: "dec_1",
      };
    },
  } as unknown as DecisionService;
}

const base = {
  botId: "bot_1",
  chainId: "chn_1",
  providerId: "fake",
  settleMs: 0,
};

const findByLabel = (descriptions: Record<string, string>, label: string) =>
  Object.entries(descriptions).find(([, text]) => text.includes(`“${label}”`))?.[0];

describe("recovery instead of giving up", () => {
  it("goes with the most likely harmless option after a second look when Jev is unsure", async () => {
    const site = siteStub(
      {
        list: {
          observation: page("https://x.test/list", "People", [
            ["button", "Connect"],
            ["button", "Dismiss"],
          ]),
          leadsTo: { Connect: "sent" },
        },
        sent: { observation: page("https://x.test/sent", "Invitation sent", [["h1", "Sent"]]) },
      },
      "list",
    );
    const steps: ComputerStepEvent[] = [];
    const result = await runFastLoop({
      ...base,
      screen: site.screen,
      goal: "Connect with the first person",
      decisionService: jev(
        (offered, d) => {
          return findByLabel(d, "Connect") ?? (offered.includes("done") ? "done" : offered[0]!);
        },
        { unsure: (d) => findByLabel(d, "Connect") !== undefined },
      ),
      onStep: (e) => steps.push(e),
    });

    expect(result.status).toBe("completed");
    expect(site.acts.some((a) => a.op === "click" && a.target === 0)).toBe(true);
    expect(steps.some((s) => /Trying another way/.test(s.reason ?? ""))).toBe(true);
  });

  it("stops offering a control that failed and tries another route", async () => {
    const site = siteStub(
      {
        list: {
          observation: page("https://x.test/list", "People", [
            ["button", "Connect"],
            ["a", "View profile"],
          ]),
          failsOnce: ["Connect"],
          leadsTo: { Connect: "sent", "View profile": "profile" },
        },
        profile: {
          observation: page("https://x.test/profile", "Profile", [["button", "Connect now"]]),
          leadsTo: { "Connect now": "sent" },
        },
        sent: { observation: page("https://x.test/sent", "Invitation sent", [["h1", "Sent"]]) },
      },
      "list",
    );
    const result = await runFastLoop({
      ...base,
      screen: site.screen,
      goal: "Connect with the first person",
      decisionService: jev((offered, d) => {
        void offered;
        return (
          findByLabel(d, "Connect") ??
          findByLabel(d, "Connect now") ??
          findByLabel(d, "View profile") ??
          "done"
        );
      }),
    });

    // The failed Connect on the list is not retried forever: the loop moved on.
    expect(site.acts.filter((a) => a.op === "click" && a.target === 0).length).toBeGreaterThan(0);
    expect(result.steps).toBeGreaterThan(2);
    expect(result.status).toBe("completed");
  });

  it("stops offering wait/scroll on a page that stalled, so a link gets picked", async () => {
    const site = siteStub(
      {
        feed: {
          observation: page("https://x.test/feed", "Home", [
            ["a", "My Network"],
            ["p", "Start a post"],
          ]),
          leadsTo: { "My Network": "network" },
        },
        network: { observation: page("https://x.test/network", "My Network", [["h1", "People"]]) },
      },
      "feed",
    );
    const result = await runFastLoop({
      ...base,
      screen: site.screen,
      goal: "Open my network",
      decisionService: jev((offered, d) => {
        if (d["done"] && Object.values(d).some((t) => t.includes("“People”"))) return "done";
        if (offered.includes("wait")) return "wait";
        return findByLabel(d, "My Network") ?? "done";
      }),
    });
    expect(result.status).toBe("completed");
    expect(site.acts.some((a) => a.op === "click" && a.target === 0)).toBe(true);
  });

  it("escalates only after the recoveries run out", async () => {
    const site = siteStub(
      { p: { observation: page("https://x.test/", "Nothing", [["p", "Hello"]]) } },
      "p",
    );
    const steps: ComputerStepEvent[] = [];
    const result = await runFastLoop({
      ...base,
      screen: site.screen,
      goal: "Do something impossible",
      decisionService: jev(() => "wait"),
      maxSteps: 60,
      maxRecoveries: 2,
      onStep: (e) => steps.push(e),
    });

    expect(result.status).toBe("escalated");
    expect(steps.filter((s) => /Trying another way/.test(s.reason ?? "")).length).toBe(2);
  });
});

describe("steps only a person can do", () => {
  const loginPage = () =>
    page("https://x.test/login", "Sign in", [
      ["input", "Email"],
      ["password", "Password"],
      ["button", "Sign in"],
    ]);

  it("does not offer 'blocked' when a saved login will be typed", async () => {
    const offered: string[][] = [];
    const site = siteStub({ login: { observation: loginPage() } }, "login");
    await runFastLoop({
      ...base,
      screen: site.screen,
      goal: "Sign in",
      decisionService: jev(() => "done", { offered }),
      hasSavedLogin: async () => true,
    });
    expect(offered[0]).not.toContain("blocked");
  });

  it("offers 'blocked' without a saved login, pauses, and carries on once the user signed in", async () => {
    const pages: Record<string, Page> = {
      login: { observation: loginPage() },
      home: {
        observation: page("https://x.test/home", "Home", [["button", "Connect"]]),
        leadsTo: { Connect: "sent" },
      },
      sent: { observation: page("https://x.test/sent", "Invitation sent", [["h1", "Sent"]]) },
    };
    const site = siteStub(pages, "login");
    const steps: ComputerStepEvent[] = [];
    let blockedCalls = 0;
    const result = await runFastLoop({
      ...base,
      screen: site.screen,
      goal: "Sign in and connect",
      decisionService: jev((offered, d) => {
        if (findByLabel(d, "Password")) return "blocked";
        return findByLabel(d, "Connect") ?? "done";
      }),
      hasSavedLogin: async () => false,
      onBlocked: async (ctx) => {
        blockedCalls += 1;
        expect(ctx.kind).toBe("login");
        // The user signs in inside the virtual machine.
        site.goTo("home");
        return "resume";
      },
      onStep: (e) => steps.push(e),
    });

    expect(blockedCalls).toBe(1);
    expect(site.takeovers).toEqual([true, false]);
    expect(steps.some((s) => s.outcome === "takeover")).toBe(true);
    expect(result.status).toBe("completed");
    expect(site.acts.some((a) => a.op === "click")).toBe(true);
  });

  it("ends as takeover when nobody handles the pause", async () => {
    const site = siteStub({ login: { observation: loginPage() } }, "login");
    const result = await runFastLoop({
      ...base,
      screen: site.screen,
      goal: "Sign in",
      decisionService: jev(() => "blocked"),
    });
    expect(result.status).toBe("takeover");
  });

  it.each([
    [page("https://x.test/", "Check", [["div", "I'm not a robot"]]), "captcha"],
    [page("https://x.test/", "2FA", [["input", "Enter the verification code"]]), "code"],
    [page("https://x.test/", "Pay", [["input", "Card number"]]), "payment"],
    [page("https://x.test/", "Sign in", [["password", "Password"]]), "login"],
    [page("https://x.test/", "Sign in", [["input", "Password"]]), "login"],
    [page("https://x.test/", "2FA", [["input", "OTP"]]), "code"],
    [page("https://x.test/", "Home", [["a", "About"]]), "other"],
  ] as const)("classifies the blocker on %#", (observation, kind) => {
    expect(classifyBlocker(observation)).toBe(kind);
  });
});

describe("asking before destructive steps", () => {
  it("asks only at the control that deletes, not on the links that lead there", async () => {
    const site = siteStub(
      {
        home: {
          observation: page("https://x.test/", "Home", [["a", "Settings"]]),
          leadsTo: { Settings: "settings" },
        },
        settings: {
          observation: page("https://x.test/settings", "Settings", [["a", "Close account"]]),
          leadsTo: { "Close account": "close" },
        },
        close: {
          observation: page("https://x.test/close", "Close account", [
            ["button", "Delete account permanently"],
          ]),
        },
      },
      "home",
    );
    const checked: Array<{ label?: string; risky: boolean }> = [];
    const result = await runFastLoop({
      ...base,
      screen: site.screen,
      goal: "Delete my account",
      decisionService: jev(
        (_offered, d) =>
          findByLabel(d, "Delete account permanently") ??
          findByLabel(d, "Close account") ??
          findByLabel(d, "Settings") ??
          "done",
        // Jev leans to "destructive" on every step of a deletion goal.
        { destructive: 0.9 },
      ),
      broker: {
        checkAction: async (input) => {
          const label =
            input.action.target !== undefined
              ? input.observation.elements[input.action.target]?.label
              : undefined;
          const risky = Boolean(input.isDestructive || input.sensitiveLabel);
          checked.push({ label, risky });
          return risky ? "ask" : "allow";
        },
      },
    });
    expect(checked).toEqual([
      { label: "Settings", risky: false },
      { label: "Close account", risky: false },
      { label: "Delete account permanently", risky: true },
    ]);
    expect(result.status).toBe("escalated");
  });
});
