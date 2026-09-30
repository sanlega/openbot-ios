import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Band, DecideResult, JevAnswer, Observation, Purpose } from "@openbot/contracts";
import type { DecisionService } from "@openbot/contracts";
import { FakeComputerProvider } from "@openbot/computer-fake";
import { runFastLoop, type FastLoopResult } from "../fast-loop.js";
import { candidateId } from "../candidates.js";

const here = dirname(fileURLToPath(import.meta.url));
const evalRoot = join(here, "../../evals");

export interface EvalStep {
  op: string;
  targetLabel?: string;
  text?: string;
  confidence?: number;
}

export interface EvalTask {
  id: string;
  goal: string;
  startPage?: string;
  startUrl?: string;
  steps: EvalStep[];
  expectStatus: FastLoopResult["status"] | "takeover";
  expectSummary?: string;
}

export function loadEvalTasks(): EvalTask[] {
  return JSON.parse(readFileSync(join(evalRoot, "tasks.json"), "utf8")) as EvalTask[];
}

export function loadEvalFixtures(): ConstructorParameters<typeof FakeComputerProvider>[0] {
  return JSON.parse(
    readFileSync(join(evalRoot, "fixtures/pages.json"), "utf8"),
  ) as ConstructorParameters<typeof FakeComputerProvider>[0];
}

/** In-process decision service that plays scripted answers per eval step. */
export class ScriptedDecisionService implements DecisionService {
  protected stepIndex = 0;
  protected observation: Observation | undefined;

  constructor(protected readonly taskSteps: EvalStep[]) {}

  async decide(): Promise<DecideResult> {
    const step = this.taskSteps[this.stepIndex] ?? { op: "done" };
    const confidence = step.confidence ?? 0.95;
    let targetChoice = "none";
    if (step.targetLabel && this.observation) {
      const index = this.observation.elements.find((el) => el.label === step.targetLabel)?.index;
      targetChoice = index !== undefined ? String(index) : "none";
    }

    const id = candidateId(step.op, targetChoice);
    const answers: Record<string, JevAnswer> = {
      action: {
        type: "choice",
        choice: id,
        confidence,
        probabilities: { [id]: 1 },
      },
      is_destructive: {
        type: "noul",
        noul: /pay|delete|confirm/i.test(step.targetLabel ?? "") ? 0.8 : 0.1,
      },
    };

    this.stepIndex += 1;
    return {
      answers,
      provider: "heuristic",
      model: "eval-script",
      latencyMs: 1,
      decisionId: `dec_eval_${this.stepIndex}`,
    };
  }

  setObservation(observation: Observation): void {
    this.observation = observation;
  }

  band(confidence: number, _purpose: Purpose): Band {
    if (confidence >= 0.9) return "auto";
    if (confidence >= 0.5) return "confirm";
    return "human";
  }

  async route() {
    return { engine: "claude" as const, model: "claude", band: "auto" as const, decisionId: "dec" };
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

export async function runEvalTask(
  task: EvalTask,
  fixtures?: ReturnType<typeof loadEvalFixtures>,
): Promise<FastLoopResult> {
  const pages = fixtures ?? loadEvalFixtures();
  const provider = new FakeComputerProvider(pages);
  await provider.ensureStarted();
  const screen = await provider.screen(`eval_${task.id}`);
  const decisionService = new ScriptedDecisionService(task.steps);

  if (task.startPage) {
    const page = pages?.pages?.[task.startPage];
    if (page?.url) {
      await screen.act({ op: "navigate", url: page.url });
    }
  }

  const originalObserve = screen.observe.bind(screen);
  screen.observe = async () => {
    const observation = await originalObserve();
    decisionService.setObservation(observation);
    return observation;
  };

  return runFastLoop({
    screen,
    decisionService,
    goal: task.goal,
    botId: `eval_${task.id}`,
    chainId: "eval",
    providerId: "fake",
    startUrl: task.startUrl,
    maxSteps: task.steps.length + 2,
    textForType: async ({ target }) => {
      const step = task.steps.find((s) => s.op === "type" && s.targetLabel === target?.label);
      return step?.text ?? "test";
    },
  });
}

export async function runEvalSuite(options?: { tasks?: EvalTask[] }): Promise<{
  passed: number;
  total: number;
  passRate: number;
  results: Array<{ id: string; ok: boolean; status: string; summary?: string }>;
}> {
  const tasks = options?.tasks ?? loadEvalTasks();
  const results = [];
  let passed = 0;

  for (const task of tasks) {
    const result = await runEvalTask(task);
    const statusOk = result.status === task.expectStatus;
    const summaryOk = task.expectSummary
      ? (result.summary ?? "").toLowerCase().includes(task.expectSummary.toLowerCase())
      : true;
    const ok = statusOk && summaryOk;
    if (ok) passed += 1;
    results.push({ id: task.id, ok, status: result.status, summary: result.summary });
  }

  return { passed, total: tasks.length, passRate: passed / tasks.length, results };
}
