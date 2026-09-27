import { monotonicFactory } from "ulid";
import {
  type Band,
  bandConfidence,
  type Bot,
  type Budget,
  type BudgetStatus,
  type DecideRequest,
  type DecideResult,
  type DecisionService,
  type Purpose,
  type RouteContext,
  type RouteDecision,
} from "@openbot/contracts";
import { BudgetManager } from "./budget-manager.js";
import { createDecisionService } from "./decision-service.js";
import { conservativeFallbackAnswers } from "./fallbacks.js";
import { JevClient } from "./jev-client.js";
import { routeBot } from "./router.js";

const ulid = monotonicFactory();

/** Model label on decisions made while no TypeSafe key is configured. */
export const UNCONFIGURED_MODEL = "unconfigured-conservative";

export interface KeyedDecisionServiceOptions {
  /** Reads the current TypeSafe key (env or vault); `undefined`/empty means not configured. */
  getApiKey: () => Promise<string | undefined>;
  /** Builds the real service for a key. Defaults to {@link createDecisionService}. */
  create?: (apiKey: string) => DecisionService;
  /** Probes a candidate key against Jev. Defaults to `JevClient.validateKey` (`GET /v1/models`). */
  probeKey?: (apiKey: string) => Promise<{ ok: boolean; rpmLimit?: number }>;
}

/**
 * Production `DecisionService` entry point (plan U1: Jev is required). Resolves
 * the TypeSafe key on every call, so a key saved by the setup wizard takes
 * effect without a restart. While no key is configured it never pretends to be
 * Jev: every decision uses the conservative outage fallbacks (spawns refused
 * unless user-requested, risk never auto, triggers dropped), and `validateKey`
 * always probes the real endpoint.
 */
export class KeyedDecisionService implements DecisionService {
  private readonly create: (apiKey: string) => DecisionService;
  private readonly probeKey: (apiKey: string) => Promise<{ ok: boolean; rpmLimit?: number }>;
  private readonly idleBudgets = new BudgetManager();
  private current?: { apiKey: string; service: DecisionService };

  constructor(private readonly options: KeyedDecisionServiceOptions) {
    this.create = options.create ?? ((apiKey) => createDecisionService({ apiKey }));
    this.probeKey = options.probeKey ?? ((apiKey) => new JevClient({ apiKey }).validateKey());
  }

  /** True when a TypeSafe key is configured, i.e. decisions go to Jev. */
  async configured(): Promise<boolean> {
    return (await this.resolve()) !== undefined;
  }

  async decide(req: DecideRequest): Promise<DecideResult> {
    const service = await this.resolve();
    if (service) return service.decide(req);

    return {
      answers: conservativeFallbackAnswers({
        purpose: req.purpose,
        state: req.state,
        questions: req.questions,
      }),
      provider: "heuristic",
      model: UNCONFIGURED_MODEL,
      latencyMs: 0,
      decisionId: `dec_${ulid()}`,
    };
  }

  async route(bot: Bot, task: string, ctx: RouteContext): Promise<RouteDecision> {
    return routeBot(this, bot, task, ctx);
  }

  band(confidence: number, _purpose: Purpose): Band {
    return bandConfidence(confidence);
  }

  budgets(): Record<Budget, BudgetStatus> {
    return (this.current?.service ?? this.idleBudgets).budgets() as Record<Budget, BudgetStatus>;
  }

  async validateKey(key: string): Promise<{ ok: boolean; rpmLimit?: number }> {
    if (!key.trim()) return { ok: false };
    return this.probeKey(key.trim());
  }

  private async resolve(): Promise<DecisionService | undefined> {
    const apiKey = (await this.options.getApiKey())?.trim();
    if (!apiKey) {
      this.current = undefined;
      return undefined;
    }
    if (this.current?.apiKey !== apiKey) {
      this.current = { apiKey, service: this.create(apiKey) };
    }
    return this.current.service;
  }
}
