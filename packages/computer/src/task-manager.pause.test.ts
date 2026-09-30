import { describe, expect, it } from "vitest";
import type {
  DecideResult,
  DecisionService,
  Observation,
  ComputerProvider,
  Screen,
} from "@openbot/contracts";
import { ComputerTaskManager } from "./task-manager.js";

/** A two-page site: a sign-in wall, then the page the task is really after. */
function siteProvider() {
  let current: "login" | "home" = "login";
  const pages: Record<string, Observation> = {
    login: {
      url: "https://www.example.test/login",
      title: "Sign in",
      elements: [
        { index: 0, role: "input", label: "Email" },
        { index: 1, role: "password", label: "Password" },
        { index: 2, role: "button", label: "Sign in" },
      ],
    },
    home: {
      url: "https://www.example.test/home",
      title: "Home",
      elements: [{ index: 0, role: "button", label: "Connect" }],
    },
  };
  const screen: Screen = {
    observe: async () => pages[current]!,
    act: async (action) => {
      if (action.op === "click" && current === "home") current = "home";
      return { ok: true };
    },
    liveView: async () => ({ url: "", token: "", expiresAt: "" }),
    takeover: async () => undefined,
  };
  const provider: ComputerProvider = {
    id: "fake",
    status: async () => ({ ready: true }),
    ensureStarted: async () => undefined,
    screen: async () => screen,
  } as unknown as ComputerProvider;
  return { provider, signIn: () => (current = "home") };
}

/** Blocks on the sign-in wall, then does the job (`done` after one click). */
const jev = (): DecisionService => {
  let clicks = 0;
  return {
    decide: async (req: { questions: Record<string, { criteria: Record<string, string> }> }) => {
      const criteria = req.questions.action!.criteria;
      const onLogin = Object.values(criteria).some((text) => text.includes("Password"));
      const choice = onLogin ? "blocked" : clicks++ === 0 ? "click_0" : "done";
      return {
        answers: {
          action: { type: "choice", choice, confidence: 0.97, probabilities: { [choice]: 0.97 } },
          is_destructive: { type: "noul", noul: 0.02 },
        },
        provider: "jev",
        model: "scripted",
        latencyMs: 1,
        decisionId: "dec",
      } satisfies DecideResult;
    },
  } as unknown as DecisionService;
};

const start = (tasks: ComputerTaskManager) =>
  tasks.start({ taskId: "t1", botId: "bot_1", chainId: "chn_1", goal: "Sign in and connect" });

describe("a task waiting for a person", () => {
  it("pauses with a structured need and carries on by itself once the user signed in", async () => {
    const site = siteProvider();
    const tasks = new ComputerTaskManager({
      decisionService: jev(),
      provider: site.provider,
      blockedPollMs: 10,
    });
    start(tasks);

    const paused = await tasks.wait("t1", 2_000);
    expect(paused?.status).toBe("needs_user");
    expect(paused?.need).toMatchObject({ kind: "login", site: "example.test" });

    site.signIn();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const done = await tasks.wait("t1", 2_000);
    expect(done?.status).toBe("completed");
    expect(done?.need).toBeUndefined();
  });

  it("carries on when the engine steers it after saving a login", async () => {
    const site = siteProvider();
    const tasks = new ComputerTaskManager({
      decisionService: jev(),
      provider: site.provider,
      blockedPollMs: 60_000,
    });
    start(tasks);
    expect((await tasks.wait("t1", 2_000))?.status).toBe("needs_user");

    site.signIn();
    tasks.steer("t1", { instruction: "The user signed in" });
    const done = await tasks.wait("t1", 2_000);
    expect(done?.status).toBe("completed");
  });

  it("stops when cancelled while waiting", async () => {
    const site = siteProvider();
    const tasks = new ComputerTaskManager({
      decisionService: jev(),
      provider: site.provider,
      blockedPollMs: 60_000,
    });
    start(tasks);
    expect((await tasks.wait("t1", 2_000))?.status).toBe("needs_user");
    expect(tasks.cancel("t1")?.status).toBe("cancelled");
  });

  it("ends as takeover when nobody comes back in time", async () => {
    const site = siteProvider();
    const tasks = new ComputerTaskManager({
      decisionService: jev(),
      provider: site.provider,
      blockedPollMs: 60_000,
      blockedTimeoutMs: 30,
    });
    start(tasks);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(tasks.get("t1")?.status).toBe("takeover");
  });

  it("picks a task that stopped short back up from the same page when steered", async () => {
    const site = siteProvider();
    site.signIn();
    const tasks = new ComputerTaskManager({ decisionService: jev(), provider: site.provider });
    tasks.start({
      taskId: "t1",
      botId: "bot_1",
      chainId: "chn_1",
      goal: "Connect",
      maxSteps: 1,
    });
    const stopped = await tasks.wait("t1", 2_000);
    expect(stopped?.status).toBe("escalated");

    tasks.steer("t1", { instruction: "Keep going" });
    const done = await tasks.wait("t1", 2_000);
    expect(done?.status).toBe("completed");
    // The earlier steps are still on record.
    expect(done?.steps.length).toBeGreaterThan(1);
  });

  it("pauses for a person when Jev types into a sign-in field with no saved login, then carries on", async () => {
    const site = siteProvider();
    // Jev goes for the Email field instead of "blocked".
    let clicks = 0;
    const typist = {
      decide: async (req: { questions: Record<string, { criteria: Record<string, string> }> }) => {
        const criteria = req.questions.action!.criteria;
        const onLogin = Object.values(criteria).some((text) => text.includes("Password"));
        const choice = onLogin ? "type_0" : clicks++ === 0 ? "click_0" : "done";
        return {
          answers: {
            action: { type: "choice", choice, confidence: 0.97, probabilities: { [choice]: 0.97 } },
            is_destructive: { type: "noul", noul: 0.02 },
          },
          provider: "jev",
          model: "scripted",
          latencyMs: 1,
          decisionId: "dec",
        } satisfies DecideResult;
      },
    } as unknown as DecisionService;
    const tasks = new ComputerTaskManager({
      decisionService: typist,
      provider: site.provider,
      blockedPollMs: 10,
      secrets: {
        resolveRef: async () => undefined,
        loginFor: async () => undefined,
        fieldKind: (label) =>
          /password/i.test(label) ? "password" : /email/i.test(label) ? "username" : undefined,
      },
    });
    start(tasks);

    const paused = await tasks.wait("t1", 2_000);
    expect(paused?.status).toBe("needs_user");
    expect(paused?.need?.kind).toBe("login");
    expect(paused?.pendingInput).toBeUndefined();

    site.signIn();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const done = await tasks.wait("t1", 2_000);
    expect(done?.status).toBe("completed");
  });
});

describe("one task per bot", () => {
  it("a new task replaces the bot's unfinished one", async () => {
    const site = siteProvider();
    const tasks = new ComputerTaskManager({
      decisionService: jev(),
      provider: site.provider,
      blockedPollMs: 60_000,
    });
    start(tasks);
    expect((await tasks.wait("t1", 2_000))?.status).toBe("needs_user");
    tasks.start({ taskId: "t2", botId: "bot_1", chainId: "chn_1", goal: "Sign in again" });
    expect(tasks.get("t1")).toMatchObject({
      status: "cancelled",
      summary: expect.stringContaining("t2"),
    });
    tasks.cancel("t2");
  });
});
