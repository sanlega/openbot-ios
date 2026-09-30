import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { FakeEngineDriver } from "@openbot/engines-fake";
import { FakeJevServer } from "./fake-jev-server.js";
import { BudgetManager } from "./budget-manager.js";
import { createDecisionService } from "./decision-service.js";
import { buildSpawnQuestions } from "./questions/spawn.js";
import { buildTriageQuestions } from "./questions/triage.js";
import { buildComputerQuestions } from "./questions/computer.js";
import { EngineLlmFallback } from "./llm-fallback.js";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

describe("WS7 load acceptance (fake-jev)", () => {
  let server: FakeJevServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = new FakeJevServer({ apiKey: "sk-load" });
    ({ url: baseUrl } = await server.listen());
  });

  afterEach(async () => {
    await server.close();
  });

  it("gate p95 stays under 600ms with 50 bots and 3 concurrent computer tasks", async () => {
    const budgets = new BudgetManager();
    const service = createDecisionService({
      apiKey: "sk-load",
      baseUrl,
      budgetManager: budgets,
    });

    const triageQuestions = buildTriageQuestions();
    const spawnQuestions = buildSpawnQuestions({ "research-bot": "research" });
    const computerQuestions = buildComputerQuestions(["0", "1", "2"]);

    const botRequests = Array.from({ length: 50 }, (_, i) =>
      service.decide({
        purpose: "triage",
        state: { message: `bot ${i} message`, roster: [] },
        questions: triageQuestions,
      }),
    );

    const computerTasks = ["task_a", "task_b", "task_c"].map((_taskId) =>
      (async () => {
        for (let step = 0; step < 8; step += 1) {
          await service.decide({
            purpose: "computer",
            state: { goal: "click", observed_elements: [{ id: "0" }] },
            questions: computerQuestions,
            timeoutMs: 400,
          });
        }
      })(),
    );

    const gateLatencies: number[] = [];
    const gateRuns = Array.from({ length: 25 }, async () => {
      const start = Date.now();
      await service.decide({
        purpose: "spawn",
        state: {
          roster: [{ id: "research-bot", description: "research" }],
          recent_user_messages: ["monitor competitors weekly"],
          request: { name: "competitor-bot", lifetime: "recurring" },
        },
        questions: spawnQuestions,
      });
      gateLatencies.push(Date.now() - start);
    });

    await Promise.all([...botRequests, ...computerTasks, ...gateRuns]);

    const p95 = percentile(gateLatencies, 0.95);
    expect(p95).toBeLessThan(600);
    expect(gateLatencies.length).toBe(25);
  });

  it("never queues gate requests behind computer when budgets are saturated", async () => {
    const budgets = new BudgetManager({
      limits: { gates: 5, interactive: 5, computer: 2, background: 5 },
      totalRpmLimit: 12,
    });

    await budgets.acquire("computer");
    await budgets.acquire("computer");

    const order: string[] = [];
    const gatePromise = budgets.acquire("gates").then(() => {
      order.push("gate");
    });
    const computerPromise = budgets.acquire("computer").then(() => {
      order.push("computer");
    });

    await gatePromise;
    expect(order[0]).toBe("gate");
    await computerPromise;
  });

  it("uses LLM fallback when Jev is down and an engine driver is configured", async () => {
    const json = JSON.stringify({
      answers: {
        route: {
          type: "choice",
          choice: "cos_itself",
          confidence: 0.91,
          probabilities: { cos_itself: 0.91 },
        },
        user_requested: { type: "noul", noul: 0.1 },
        existing_can_do: { type: "noul", noul: 0.8 },
        one_off: { type: "noul", noul: 0.7 },
        substantial_work: { type: "noul", noul: 0.2 },
        recurring_ownership: { type: "noul", noul: 0.2 },
        distinct_boundary: { type: "noul", noul: 0.1 },
        duplicates_existing: { type: "noul", noul: 0.1 },
      },
    });
    const driver = new FakeEngineDriver({ replies: [json] });
    const service = createDecisionService({
      apiKey: "sk-load",
      baseUrl: "http://127.0.0.1:1",
      llmFallback: new EngineLlmFallback({ driver }),
    });

    const result = await service.decide({
      purpose: "delegate",
      state: { request: { description: "weekly digest" } },
      questions: buildSpawnQuestions({}),
    });

    expect(result.provider).toBe("llm");
    expect(result.answers.route?.type).toBe("choice");
    await driver.dispose();
  });
});
