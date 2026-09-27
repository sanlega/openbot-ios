import { monotonicFactory } from "ulid";
import {
  type Band,
  bandConfidence,
  type Bot,
  type BudgetStatus,
  type DecideRequest,
  type DecideResult,
  type DecisionService,
  type Purpose,
  type RouteContext,
  type RouteDecision,
} from "@openbot/contracts";
import { BudgetManager } from "./budget-manager.js";
import {
  conservativeFallbackAnswers,
  LLM_FALLBACK_PURPOSES,
  type LlmFallback,
} from "./fallbacks.js";
import { DecisionLog, primaryAnswerIdForPurpose } from "./decision-log.js";
import { JevClient, jevTimeoutMs, PINNED_JEV_MODEL } from "./jev-client.js";
import { routeBot } from "./router.js";

const ulid = monotonicFactory();

export interface DecisionServiceOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  budgetManager?: BudgetManager;
  decisionLog?: DecisionLog;
  llmFallback?: LlmFallback;
  /** Passed through to Jev for computer-purpose calls (120 req/min per task, plan O4). */
  computerTaskId?: string;
}

/**
 * Production `DecisionService` (plan §4.4 / WS7): Jev client with purpose budgets,
 * retries, conservative fallbacks, decision logging (`x-typesafe-request-id`), and
 * the model router (`route()`).
 */
export class DecisionServiceImpl implements DecisionService {
  private readonly jev: JevClient;
  private readonly budgets_: BudgetManager;
  private readonly log: DecisionLog;
  private readonly llmFallback?: LlmFallback;
  private readonly computerTaskId: string;

  constructor(options: DecisionServiceOptions) {
    this.jev = new JevClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model ?? PINNED_JEV_MODEL,
    });
    this.budgets_ = options.budgetManager ?? new BudgetManager();
    this.log = options.decisionLog ?? new DecisionLog();
    this.llmFallback = options.llmFallback;
    this.computerTaskId = options.computerTaskId ?? "default";
  }

  async decide(req: DecideRequest): Promise<DecideResult> {
    const started = Date.now();
    const budget = this.budgets_.purposeBudget(req.purpose);
    const release = await this.budgets_.acquire(budget, {
      computerTaskId: req.purpose === "computer" ? this.computerTaskId : undefined,
    });

    try {
      const timeoutMs = req.timeoutMs ?? jevTimeoutMs(req.purpose);
      const jevResult = await this.jev.systemOne({
        state: req.state,
        questions: req.questions,
        timeoutMs,
      });

      const decisionId = this.log.record({
        purpose: req.purpose,
        provider: "jev",
        model: jevResult.response.model,
        state: req.state,
        answers: jevResult.response.answers,
        requestId: jevResult.requestId,
        primaryAnswerId: primaryAnswerIdForPurpose(req.purpose, req.questions),
      });

      return {
        answers: jevResult.response.answers,
        provider: "jev",
        model: jevResult.response.model,
        latencyMs: jevResult.latencyMs,
        decisionId,
        requestId: jevResult.requestId,
      };
    } catch {
      const fallback = await this.fallback(req);
      const decisionId = this.log.record({
        purpose: req.purpose,
        provider: fallback.provider,
        model: fallback.model,
        state: req.state,
        answers: fallback.answers,
        primaryAnswerId: primaryAnswerIdForPurpose(req.purpose, req.questions),
      });
      return { ...fallback, decisionId, latencyMs: Date.now() - started };
    } finally {
      release();
    }
  }

  private async fallback(req: DecideRequest): Promise<Omit<DecideResult, "decisionId">> {
    if (this.llmFallback && LLM_FALLBACK_PURPOSES.has(req.purpose)) {
      const llmAnswers = await this.llmFallback.answer(req);
      if (llmAnswers) {
        return {
          answers: llmAnswers,
          provider: "llm",
          model: "llm-fallback",
          latencyMs: 0,
        };
      }
    }

    const answers = conservativeFallbackAnswers({
      purpose: req.purpose,
      state: req.state,
      questions: req.questions,
    });

    return {
      answers,
      provider: "heuristic",
      model: "conservative-fallback",
      latencyMs: 0,
    };
  }

  async route(bot: Bot, task: string, ctx: RouteContext): Promise<RouteDecision> {
    return routeBot(this, bot, task, ctx);
  }

  band(confidence: number, _purpose: Purpose): Band {
    return bandConfidence(confidence);
  }

  budgets(): Record<string, BudgetStatus> {
    return this.budgets_.budgets();
  }

  async validateKey(key: string): Promise<{ ok: boolean; rpmLimit?: number }> {
    const probe = new JevClient({ apiKey: key, baseUrl: this.jev.endpoint });
    return probe.validateKey();
  }

  /** Test hook: expose logged decisions. */
  decisions(): ReturnType<DecisionLog["list"]> {
    return this.log.list();
  }
}

export function createDecisionService(options: DecisionServiceOptions): DecisionServiceImpl {
  return new DecisionServiceImpl(options);
}

/** Stable id helper for tests that stub decide(). */
export function newDecisionId(): string {
  return `dec_${ulid()}`;
}
