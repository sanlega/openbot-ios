import { describe, expect, it } from "vitest";
import type { Action, DecisionService, Observation, Screen } from "@openbot/contracts";
import { runFastLoop, type ComputerStepEvent } from "./fast-loop.js";

const withNotice: Observation = {
  url: "https://www.youtube.com/",
  title: "YouTube",
  elements: [
    { index: 0, role: "h2", label: "Before you continue to YouTube" },
    { index: 1, role: "a", label: "cookies" },
    {
      index: 2,
      role: "button",
      label: "Reject the use of cookies and other data for the purposes described",
    },
    {
      index: 3,
      role: "button",
      label: "Accept the use of cookies and other data for the purposes described",
    },
    { index: 4, role: "combobox", label: "Search" },
  ],
};
const home: Observation = {
  url: "https://www.youtube.com/",
  title: "YouTube",
  elements: [{ index: 0, role: "combobox", label: "Search" }],
};

function screenStub() {
  const acts: Action[] = [];
  let page = withNotice;
  const screen: Screen = {
    observe: async () => page,
    act: async (action) => {
      acts.push(action);
      if (action.op === "click" && action.target === 2) page = home;
      return { ok: true };
    },
    liveView: async () => ({ url: "", token: "", expiresAt: "" }),
    takeover: async () => undefined,
  };
  return { screen, acts };
}

/** Jev isn't sure of anything: without the notice handling the loop stops at once. */
const unsure = {
  decide: async () => ({
    answers: {
      op: { type: "choice", choice: "type", confidence: 0.3, probabilities: { type: 0.3 } },
      target_index: { type: "choice", choice: "4", confidence: 0.3, probabilities: { "4": 0.3 } },
      is_destructive: { type: "noul", noul: 0.05 },
    },
    provider: "jev",
    model: "test",
    latencyMs: 1,
    decisionId: "dec_1",
  }),
} as unknown as DecisionService;

describe("cookie notices", () => {
  it("closes the notice (rejecting) before asking Jev about the goal", async () => {
    const { screen, acts } = screenStub();
    const steps: ComputerStepEvent[] = [];

    await runFastLoop({
      screen,
      decisionService: unsure,
      goal: "Search YouTube for sanlega",
      botId: "bot_1",
      chainId: "chn_1",
      providerId: "docker",
      maxSteps: 3,
      onStep: (s) => steps.push(s),
    });

    expect(acts[0]).toEqual({ op: "click", target: 2 });
    expect(steps[0]).toMatchObject({ outcome: "executed", reason: "Closed a cookie notice" });
  });
});

describe("search boxes", () => {
  it("submits a search box right after typing into it", async () => {
    const acts: Action[] = [];
    const page: Observation = {
      url: "https://en.wikipedia.org/",
      title: "Wikipedia",
      elements: [{ index: 0, role: "searchbox", label: "Search Wikipedia" }],
    };
    const screen: Screen = {
      observe: async () => page,
      act: async (action) => {
        acts.push(action);
        return { ok: true };
      },
      liveView: async () => ({ url: "", token: "", expiresAt: "" }),
      takeover: async () => undefined,
    };
    const typeIt = {
      decide: async () => ({
        answers: {
          action: {
            type: "choice",
            choice: "type_0",
            confidence: 0.9,
            probabilities: { type_0: 0.92 },
          },
          is_destructive: { type: "noul", noul: 0.02 },
        },
        provider: "jev",
        model: "test",
        latencyMs: 1,
        decisionId: "dec_1",
      }),
    } as unknown as DecisionService;

    await runFastLoop({
      screen,
      decisionService: typeIt,
      goal: "Search Wikipedia for Ada Lovelace",
      botId: "bot_1",
      chainId: "chn_1",
      providerId: "fake",
      maxSteps: 1,
      textForType: async () => "Ada Lovelace",
    });

    expect(acts.slice(0, 2)).toEqual([
      { op: "type", target: 0, text: "Ada Lovelace" },
      { op: "key", text: "Enter" },
    ]);
  });
});
