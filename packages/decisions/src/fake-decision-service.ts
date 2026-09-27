import { monotonicFactory } from "ulid";
import {
  type Band,
  type Budget,
  type BudgetStatus,
  type DecideRequest,
  type DecideResult,
  type DecisionService,
  type Purpose,
  bandConfidence,
} from "@openbot/contracts";
import { synthesizeAnswer } from "./answer-synthesis.js";

const ulid = monotonicFactory();
const BUDGETS: Budget[] = ["gates", "interactive", "computer", "background"];

/**
 * In-process `DecisionService` (plan §5 WS0 fakes list, "fake Jev"): synthesizes
 * answers deterministically with no HTTP round trip and no real key, for any
 * workstream (WS2/WS8/WS9/WS12) that just needs *a* working `DecisionService`
 * in tests. For wire-level fidelity tests against the actual HTTP contract,
 * use {@link FakeJevServer} instead.
 */
export class FakeDecisionService implements DecisionService {
  private readonly rpmLimits: Record<Budget, number>;
  private readonly callTimestampsMs: Record<Budget, number[]> = {
    gates: [],
    interactive: [],
    computer: [],
    background: [],
  };

  constructor(rpmLimits: Partial<Record<Budget, number>> = {}) {
    this.rpmLimits = {
      gates: rpmLimits.gates ?? 60,
      interactive: rpmLimits.interactive ?? 120,
      computer: rpmLimits.computer ?? 60,
      background: rpmLimits.background ?? 30,
    };
  }

  async decide(req: DecideRequest): Promise<DecideResult> {
    const start = Date.now();
    const answers = Object.fromEntries(
      Object.entries(req.questions).map(([id, question]) => [id, synthesizeAnswer(question)]),
    );
    return {
      answers,
      provider: "heuristic",
      model: "fake-decision-service",
      latencyMs: Date.now() - start,
      decisionId: `dec_${ulid()}`,
    };
  }

  band(confidence: number, _purpose: Purpose): Band {
    return bandConfidence(confidence);
  }

  budgets(): Record<Budget, BudgetStatus> {
    const now = Date.now();
    const result = {} as Record<Budget, BudgetStatus>;
    for (const budget of BUDGETS) {
      const recent = this.callTimestampsMs[budget].filter((ts) => now - ts < 60_000);
      this.callTimestampsMs[budget] = recent;
      result[budget] = { limitRpm: this.rpmLimits[budget], usedRpm: recent.length, queued: 0 };
    }
    return result;
  }

  async validateKey(key: string): Promise<{ ok: boolean; rpmLimit?: number }> {
    return key.trim().length > 0 ? { ok: true, rpmLimit: 120 } : { ok: false };
  }
}
