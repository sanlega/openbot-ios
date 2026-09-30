import { describe, expect, it } from "vitest";
import type { DecideResult, DecisionService, JevAnswer } from "@openbot/contracts";
import { FakeComputerProvider } from "@openbot/computer-fake";
import { conservativeFallbackAnswers } from "@openbot/decisions";
import { ComputerTaskManager } from "./task-manager.js";
import { candidateId } from "./candidates.js";

const choice = (value: string, confidence = 0.97): JevAnswer => ({
  type: "choice",
  choice: value,
  confidence,
  probabilities: { [value]: confidence },
});
const safe: JevAnswer = { type: "noul", noul: 0.05 };

/** Jev stand-in that answers each step from a script (op, target). */
function scriptedJev(script: Array<[op: string, target: string]>): DecisionService {
  let i = 0;
  return {
    decide: async () => {
      const [op, target] = script[Math.min(i, script.length - 1)]!;
      i += 1;
      return {
        answers: {
          action: choice(candidateId(op, target)),
          is_destructive: safe,
        },
        provider: "jev",
        model: "scripted",
        latencyMs: 1,
        decisionId: `dec_${i}`,
      } satisfies DecideResult;
    },
  } as unknown as DecisionService;
}

function manager(decisionService: DecisionService, provider = new FakeComputerProvider()) {
  return {
    provider,
    tasks: new ComputerTaskManager({ decisionService, provider, inputTimeoutMs: 5_000 }),
  };
}

const start = (tasks: ComputerTaskManager, extra: { inputs?: Record<string, string> } = {}) =>
  tasks.start({
    taskId: "ctask_1",
    botId: "bot_1",
    chainId: "chn_1",
    goal: "Write an email with subject Q3",
    ...extra,
  });

describe("ComputerTaskManager", () => {
  it("asks the engine for text when Jev picks a field, then finishes after steering", async () => {
    // inbox: click Compose (0) → compose: type into Subject (1) → done
    const { tasks, provider } = manager(
      scriptedJev([
        ["click", "0"],
        ["type", "1"],
        ["done", "none"],
      ]),
    );
    start(tasks);

    const waiting = await tasks.wait("ctask_1", 2_000);
    expect(waiting).toMatchObject({ status: "needs_input", pendingInput: { field: "Subject" } });

    tasks.steer("ctask_1", { text: "Q3 numbers", instruction: "Keep it short" });
    const done = await tasks.wait("ctask_1", 2_000);
    expect(done?.status).toBe("completed");
    expect(done?.instructions).toEqual(["Keep it short"]);
    expect(done?.steps.map((s) => [s.op, s.target, s.outcome])).toEqual([
      ["click", "Compose", "executed"],
      ["type", "Subject", "executed"],
      ["done", undefined, "done"],
    ]);
    const screen = await provider.screen("bot_1");
    const subject = (await screen.observe()).elements.find((e) => e.label === "Subject");
    expect(subject?.value).toBe("Q3 numbers");
  });

  it("uses text the engine supplied up front, without pausing", async () => {
    const { tasks } = manager(
      scriptedJev([
        ["click", "0"],
        ["type", "1"],
        ["done", "none"],
      ]),
    );
    start(tasks, { inputs: { subject: "Q3 numbers" } });
    let snapshot = await tasks.wait("ctask_1", 2_000);
    while (snapshot?.status === "running") snapshot = await tasks.wait("ctask_1", 2_000);
    expect(snapshot?.status).toBe("completed");
  });

  describe("secrets typed from the vault", () => {
    const script: Array<[string, string]> = [
      ["click", "0"],
      ["type", "1"],
      ["done", "none"],
    ];

    async function finish(tasks: ComputerTaskManager) {
      let snapshot = await tasks.wait("ctask_1", 2_000);
      while (snapshot?.status === "running") snapshot = await tasks.wait("ctask_1", 2_000);
      return snapshot;
    }

    it("types a secret: reference from the vault without the engine ever seeing it", async () => {
      const provider = new FakeComputerProvider();
      const tasks = new ComputerTaskManager({
        decisionService: scriptedJev(script),
        provider,
        inputTimeoutMs: 5_000,
        secrets: {
          resolveRef: async (ref) =>
            ref === "secret:input.x.subject" ? "Vault value 42" : undefined,
          loginFor: async () => undefined,
          fieldKind: () => undefined,
        },
      });
      start(tasks, { inputs: { subject: "secret:input.x.subject" } });
      const snapshot = await finish(tasks);
      expect(snapshot?.status).toBe("completed");
      const screen = await provider.screen("bot_1");
      const subject = (await screen.observe()).elements.find((e) => e.label === "Subject");
      expect(subject?.value).toBe("Vault value 42");
      expect(JSON.stringify(snapshot)).not.toContain("Vault value 42");
    });

    it("types the saved login for the page when the field asks for it, without pausing", async () => {
      const provider = new FakeComputerProvider();
      const seenUrls: Array<string | undefined> = [];
      const tasks = new ComputerTaskManager({
        decisionService: scriptedJev(script),
        provider,
        inputTimeoutMs: 5_000,
        secrets: {
          resolveRef: async () => undefined,
          loginFor: async (url) => {
            seenUrls.push(url);
            return { username: "me@example.com", password: "pw" };
          },
          // Pretend this page's "Subject" box is the sign-in name field.
          fieldKind: (label) => (label === "Subject" ? "username" : undefined),
        },
      });
      start(tasks);
      const snapshot = await finish(tasks);
      expect(snapshot?.status).toBe("completed");
      const screen = await provider.screen("bot_1");
      const page = await screen.observe();
      const subject = page.elements.find((e) => e.label === "Subject");
      expect(subject?.value).toBe("me@example.com");
      // The login is looked up for the page being typed into, not the page of the previous step
      // (regression: a live run found the saved login for the wrong, earlier page).
      expect(seenUrls[0]).toBe(page.url);
    });

    it("masks a typed secret in every later observation, so Jev never sees it", async () => {
      const provider = new FakeComputerProvider();
      const states: string[] = [];
      const recording = {
        decide: async (req: { state: unknown }) => {
          states.push(JSON.stringify(req.state));
          const [op, target] = script[Math.min(states.length - 1, script.length - 1)]!;
          return {
            answers: { action: choice(candidateId(op, target)), is_destructive: safe },
            provider: "jev",
            model: "scripted",
            latencyMs: 1,
            decisionId: `dec_${states.length}`,
          } satisfies DecideResult;
        },
      } as unknown as DecisionService;
      const tasks = new ComputerTaskManager({
        decisionService: recording,
        provider,
        inputTimeoutMs: 5_000,
        secrets: {
          resolveRef: async () => "Vault value 42",
          loginFor: async () => undefined,
          fieldKind: () => undefined,
        },
      });
      start(tasks, { inputs: { subject: "secret:input.x.subject" } });
      await finish(tasks);
      // The fake page did hold the secret after typing...
      const screen = await provider.screen("bot_1");
      expect((await screen.observe()).elements.find((e) => e.label === "Subject")?.value).toBe(
        "Vault value 42",
      );
      // ...but nothing Jev was asked afterwards contains it.
      expect(states.length).toBeGreaterThan(2);
      expect(states.join("|")).not.toContain("Vault value 42");
    });

    it("does not let an empty or very short input key match every field", async () => {
      const secrets = {
        resolveRef: async () => "leaked",
        loginFor: async () => undefined,
        fieldKind: () => undefined,
      };
      for (const inputs of [{ "": "secret:input.x.a" }, { Su: "secret:input.x.a" }] as Array<
        Record<string, string>
      >) {
        const tasks = new ComputerTaskManager({
          decisionService: scriptedJev(script),
          provider: new FakeComputerProvider(),
          inputTimeoutMs: 5_000,
          secrets,
        });
        start(tasks, { inputs });
        const waiting = await tasks.wait("ctask_1", 2_000);
        expect(waiting).toMatchObject({
          status: "needs_input",
          pendingInput: { field: "Subject" },
        });
        tasks.cancel("ctask_1");
      }
    });

    it("asks the engine when the referenced secret is gone", async () => {
      const tasks = new ComputerTaskManager({
        decisionService: scriptedJev(script),
        provider: new FakeComputerProvider(),
        inputTimeoutMs: 5_000,
        secrets: {
          resolveRef: async () => undefined,
          loginFor: async () => undefined,
          fieldKind: () => undefined,
        },
      });
      start(tasks, { inputs: { subject: "secret:input.gone.subject" } });
      const waiting = await tasks.wait("ctask_1", 2_000);
      expect(waiting).toMatchObject({ status: "needs_input", pendingInput: { field: "Subject" } });
    });
  });

  it("cancels a task that is waiting for text", async () => {
    const { tasks } = manager(
      scriptedJev([
        ["click", "0"],
        ["type", "1"],
      ]),
    );
    start(tasks);
    expect((await tasks.wait("ctask_1", 2_000))?.status).toBe("needs_input");
    expect(tasks.cancel("ctask_1")?.status).toBe("cancelled");
    expect(tasks.get("ctask_1")?.status).toBe("cancelled");
  });

  it("stops instead of acting when Jev is unavailable", async () => {
    const unavailable = {
      decide: async (req: { purpose: "computer"; state: unknown; questions: never }) => ({
        answers: conservativeFallbackAnswers({
          purpose: "computer",
          state: {},
          questions: req.questions,
        }),
        provider: "heuristic",
        model: "conservative-fallback",
        latencyMs: 1,
        decisionId: "dec_fallback",
      }),
    } as unknown as DecisionService;
    const { tasks, provider } = manager(unavailable);
    start(tasks);
    let snapshot = await tasks.wait("ctask_1", 2_000);
    while (snapshot?.status === "running") snapshot = await tasks.wait("ctask_1", 2_000);
    expect(snapshot?.status).toBe("escalated");
    expect(snapshot?.summary).toContain("Jev is unavailable");
    // Nothing was clicked: still on the inbox.
    const screen = await provider.screen("bot_1");
    expect((await screen.observe()).title).toContain("Inbox");
  });

  it("stops with a clear reason when Jev never answers, and reports its phase", async () => {
    const hanging = { decide: () => new Promise(() => undefined) } as unknown as DecisionService;
    const phases: string[] = [];
    const tasks = new ComputerTaskManager({
      decisionService: hanging,
      provider: new FakeComputerProvider(),
      onUpdate: (s) => s.phase && phases.push(s.phase),
      timeouts: { decide: 200 },
    });
    tasks.start({ taskId: "ctask_h", botId: "bot_1", chainId: "chn_1", goal: "anything" });
    let snapshot = await tasks.wait("ctask_h", 5_000);
    while (snapshot?.status === "running") snapshot = await tasks.wait("ctask_h", 5_000);
    expect(snapshot?.status).toBe("escalated");
    expect(snapshot?.summary).toContain("Jev didn't answer in time");
    expect(phases).toContain("deciding");
  });
});
