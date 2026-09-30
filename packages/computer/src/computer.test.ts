import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { JevAnswer } from "@openbot/contracts";
import { FakeComputerProvider } from "@openbot/computer-fake";
import { FakeJevServer } from "@openbot/decisions";
import { createDecisionService } from "@openbot/decisions";
import { isSensitiveLabel } from "./sensitive-target.js";
import { runFastLoop } from "./fast-loop.js";
import { createComputerAgent } from "./computer-agent.js";
import type { DecisionService } from "@openbot/contracts";
import type { ComputerActionBroker } from "./broker.js";
import { DefaultComputerActionBroker } from "./broker.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "../../decisions/fixtures/jev/computer-action");

function readFixture(name: string): {
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
} {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as {
    state: Record<string, unknown>;
    questions: Record<string, unknown>;
  };
}

describe("sensitive targets", () => {
  it("flags Pay labels per plan WS2 ask rules", () => {
    expect(isSensitiveLabel("Pay now")).toBe(true);
    expect(isSensitiveLabel("Compose")).toBe(false);
  });
});

describe("runFastLoop", () => {
  let server: FakeJevServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = new FakeJevServer({ apiKey: "sk-test" });
    const fixture = readFixture("pick-op-and-target.response.json") as unknown as {
      answers: Record<string, JevAnswer>;
    };
    // Jev torn between two elements (recorded pattern: 0.48 vs 0.46).
    server.scriptedAnswers.action = {
      type: "choice",
      choice: "click_0",
      confidence: 0.4,
      probabilities: { click_0: 0.48, click_1: 0.46, wait: 0.06 },
    };
    server.scriptedAnswers.is_destructive = fixture.answers.is_destructive!;
    // The end-of-task check: by default the page doesn't show the goal done.
    server.scriptedAnswers.goal_met = {
      type: "choice",
      choice: "no",
      confidence: 0.95,
      probabilities: { no: 0.95, yes: 0.05 },
    };
    ({ url: baseUrl } = await server.listen());
  });

  afterEach(async () => {
    await server.close();
  });

  it("escalates when Jev target confidence is below confirm band", async () => {
    const provider = new FakeComputerProvider();
    await provider.ensureStarted();
    const screen = await provider.screen("bot_1");
    const decisionService = createDecisionService({ apiKey: "sk-test", baseUrl });

    const result = await runFastLoop({
      screen,
      decisionService,
      goal: "Send a test email",
      botId: "bot_1",
      chainId: "chain_1",
      providerId: "fake",
      maxSteps: 3,
      maxRecoveries: 0,
    });

    expect(result.status).toBe("escalated");
    expect(result.summary).toMatch(/wasn.t sure what to do/i);
  });

  it("reports success when it stops short but Jev sees the goal already done", async () => {
    server.scriptedAnswers.goal_met = {
      type: "choice",
      choice: "yes",
      confidence: 0.96,
      probabilities: { yes: 0.96, no: 0.04 },
    };
    const provider = new FakeComputerProvider();
    await provider.ensureStarted();
    const screen = await provider.screen("bot_1");
    const decisionService = createDecisionService({ apiKey: "sk-test", baseUrl });

    const result = await runFastLoop({
      screen,
      decisionService,
      goal: "Open the inbox",
      botId: "bot_1",
      chainId: "chain_1",
      providerId: "fake",
      maxSteps: 3,
    });

    expect(result.status).toBe("completed");
    expect(result.summary).toMatch(/checked by Jev/);
  });

  it("keeps the failure when Jev isn't confident the goal is done", async () => {
    server.scriptedAnswers.goal_met = {
      type: "choice",
      choice: "yes",
      confidence: 0.6,
      probabilities: { yes: 0.6, no: 0.4 },
    };
    const provider = new FakeComputerProvider();
    await provider.ensureStarted();
    const screen = await provider.screen("bot_1");
    const decisionService = createDecisionService({ apiKey: "sk-test", baseUrl });

    const result = await runFastLoop({
      screen,
      decisionService,
      goal: "Open the inbox",
      botId: "bot_1",
      chainId: "chain_1",
      providerId: "fake",
      maxSteps: 3,
    });

    expect(result.status).toBe("escalated");
  });

  it("never acts on an element index that was not observed", async () => {
    server.scriptedAnswers.action = {
      type: "choice",
      choice: "click_999",
      confidence: 0.95,
      probabilities: { click_999: 1 },
    };

    const provider = new FakeComputerProvider();
    await provider.ensureStarted();
    const screen = await provider.screen("bot_1");
    const decisionService = createDecisionService({ apiKey: "sk-test", baseUrl });

    const result = await runFastLoop({
      screen,
      decisionService,
      goal: "Click compose",
      botId: "bot_1",
      chainId: "chain_1",
      providerId: "fake",
      maxSteps: 2,
      maxRecoveries: 0,
    });

    expect(result.status).toBe("escalated");
    expect(result.summary).toMatch(/isn.t on the page/i);
  });

  it("raises approval path for sensitive Pay targets", async () => {
    server.scriptedAnswers.action = {
      type: "choice",
      choice: "click_0",
      confidence: 0.95,
      probabilities: { click_0: 1 },
    };

    const fixtures = {
      startPage: "pay",
      pages: {
        pay: {
          url: "https://fake.local/pay",
          title: "Checkout",
          elements: [{ role: "button", label: "Pay now" }],
        },
      },
    };

    const provider = new FakeComputerProvider(fixtures);
    await provider.ensureStarted();
    const screen = await provider.screen("bot_1");
    const decisionService = createDecisionService({ apiKey: "sk-test", baseUrl });

    const result = await runFastLoop({
      screen,
      decisionService,
      goal: "Complete checkout",
      botId: "bot_1",
      chainId: "chain_1",
      providerId: "fake",
      maxSteps: 2,
    });

    expect(result.status).toBe("escalated");
    expect(result.summary).toMatch(/approval/i);
  });

  it("completes inbox fixture flow when Jev picks high-confidence steps", async () => {
    let step = 0;

    const provider = new FakeComputerProvider();
    await provider.ensureStarted();
    const screen = await provider.screen("bot_1");
    const decisionService = createDecisionService({ apiKey: "sk-test", baseUrl });

    const originalDecide = decisionService.decide.bind(decisionService);
    decisionService.decide = async (req) => {
      const response = await originalDecide(req);
      step += 1;
      if (step === 1) {
        return {
          ...response,
          answers: {
            ...response.answers,
            action: {
              type: "choice",
              choice: "click_0",
              confidence: 0.95,
              probabilities: { click_0: 1 },
            },
            is_destructive: { type: "noul", noul: 0.1 },
          },
        };
      }
      if (step === 2) {
        return {
          ...response,
          answers: {
            ...response.answers,
            action: {
              type: "choice",
              choice: "done",
              confidence: 0.99,
              probabilities: { done: 1 },
            },
          },
        };
      }
      return response;
    };

    const result = await runFastLoop({
      screen,
      decisionService,
      goal: "Open compose",
      botId: "bot_1",
      chainId: "chain_1",
      providerId: "fake",
      maxSteps: 5,
    });

    expect(result.status).toBe("completed");
  });
});

describe("ComputerAgentImpl", () => {
  it("runs a task through a registered provider", async () => {
    const provider = new FakeComputerProvider();
    const agent = createComputerAgent(new StubDecisionService(), [provider]);
    const result = await agent.runTask({
      botId: "bot_1",
      chainId: "chain_1",
      goal: "noop",
      maxSteps: 1,
    });
    expect(result.steps).toBeGreaterThan(0);
  });
});

class StubDecisionService implements DecisionService {
  async decide() {
    return {
      answers: {
        action: { type: "choice" as const, choice: "done", confidence: 0.99, probabilities: {} },
        is_destructive: { type: "noul" as const, noul: 0 },
      },
      provider: "heuristic" as const,
      model: "stub",
      latencyMs: 0,
      decisionId: "dec_test",
    };
  }

  async route() {
    return {
      engine: "claude" as const,
      model: "claude",
      band: "auto" as const,
      decisionId: "dec_test",
    };
  }

  band() {
    return "auto" as const;
  }

  budgets() {
    return {
      gates: { limitRpm: 1, usedRpm: 0, queued: 0 },
      interactive: { limitRpm: 1, usedRpm: 0, queued: 0 },
      computer: { limitRpm: 1, usedRpm: 0, queued: 0 },
      background: { limitRpm: 1, usedRpm: 0, queued: 0 },
    };
  }

  async validateKey() {
    return { ok: true };
  }
}

describe("DefaultComputerActionBroker", () => {
  it("always asks for local provider actions", async () => {
    const broker: ComputerActionBroker = new DefaultComputerActionBroker();
    const decision = await broker.checkAction({
      botId: "b",
      chainId: "c",
      providerId: "local",
      action: { op: "click", target: 0 },
      observation: { elements: [{ index: 0, role: "button", label: "OK" }] },
    });
    expect(decision).toBe("ask");
  });
});
