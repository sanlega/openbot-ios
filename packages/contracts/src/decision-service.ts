import { z } from "zod";
import { JevAnswer, JevQuestion } from "./jev.js";
import type { Bot } from "./entities.js";
import { EngineId } from "./entities.js";

/** Plan §4.4. `purpose -> budget` is a fixed mapping in code, not configurable per call. */
export const Purpose = z.enum([
  "route",
  "triage",
  "delegate",
  "risk",
  "spawn",
  "notify",
  "loop",
  "attention",
  "trigger",
  "computer",
]);
export type Purpose = z.infer<typeof Purpose>;

export const Budget = z.enum(["gates", "interactive", "computer", "background"]);
export type Budget = z.infer<typeof Budget>;

/** `purpose -> budget`, fixed in code (plan §4.4/O4). Gates (risk/spawn/notify/loop) are always `gates`. */
export const PURPOSE_BUDGET: Record<Purpose, Budget> = {
  route: "interactive",
  triage: "interactive",
  delegate: "interactive",
  risk: "gates",
  spawn: "gates",
  notify: "gates",
  loop: "gates",
  attention: "background",
  trigger: "background",
  computer: "computer",
};

export const Band = z.enum(["auto", "confirm", "human"]);
export type Band = z.infer<typeof Band>;

export const DecisionProvider = z.enum(["jev", "llm", "heuristic"]);
export type DecisionProvider = z.infer<typeof DecisionProvider>;

export const DecideRequest = z.object({
  purpose: Purpose,
  state: z.union([z.string(), z.record(z.string(), z.unknown())]),
  questions: z.record(z.string(), JevQuestion),
  timeoutMs: z.number().int().positive().optional(),
});
export type DecideRequest = z.infer<typeof DecideRequest>;

export const DecideResult = z.object({
  answers: z.record(z.string(), JevAnswer),
  provider: DecisionProvider,
  model: z.string(),
  latencyMs: z.number().nonnegative(),
  decisionId: z.string(),
  /** From the response's `x-typesafe-request-id` header; absent for llm/heuristic fallbacks. */
  requestId: z.string().optional(),
});
export type DecideResult = z.infer<typeof DecideResult>;

export const BudgetStatus = z.object({
  limitRpm: z.number().int().nonnegative(),
  usedRpm: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
});
export type BudgetStatus = z.infer<typeof BudgetStatus>;

/** Plan O4 default RPM ceilings (of the 1,000 req/min budget sized from the key limit). */
export const DEFAULT_BUDGET_LIMITS: Record<Budget, number> = {
  gates: 250,
  interactive: 200,
  computer: 450,
  background: 100,
};

/** Total RPM budget sized from the documented 1,200 req/min key limit (plan O4). */
export const DEFAULT_TOTAL_RPM_LIMIT = 1000;

export const RouteContext = z.object({
  availableEngines: z.array(EngineId),
  /** Engine id → model ids from `models.json`. */
  modelsCatalog: z.record(z.string(), z.array(z.string())),
  /** The engine this Bot's session was most recently active on, if any — switching away loses that engine's own conversation memory (session resume is per bot+engine). */
  currentEngine: EngineId.optional(),
  /** Minutes since `currentEngine`'s session was last used; omitted if there's no `currentEngine`. */
  currentEngineIdleMinutes: z.number().optional(),
  /** Engine id → display name and what it is good at (D-031), for the route question. */
  engineInfo: z
    .record(z.string(), z.object({ label: z.string(), summary: z.string().optional() }))
    .optional(),
  /** `engine:model` keys that run on this computer (Ollama, LM Studio): free, private, weaker. */
  localModels: z.array(z.string()).optional(),
});
export type RouteContext = z.infer<typeof RouteContext>;

export const RouteDecision = z.object({
  engine: EngineId,
  model: z.string(),
  effort: z.enum(["low", "medium", "high"]).optional(),
  complexity: z.number().optional(),
  needsComputer: z.boolean().optional(),
  band: Band,
  decisionId: z.string(),
});
export type RouteDecision = z.infer<typeof RouteDecision>;

/**
 * `DecisionService` (WS7 implements; WS2/WS8/WS9/WS12 call). Drivers/fakes never
 * import each other — everything routes through this interface so a fake-jev
 * implementation is a drop-in replacement in tests.
 */
export interface DecisionService {
  decide(req: DecideRequest): Promise<DecideResult>;
  route(bot: Bot, task: string, ctx: RouteContext): Promise<RouteDecision>;
  band(confidence: number, purpose: Purpose): Band;
  budgets(): Record<Budget, BudgetStatus>;
  validateKey(key: string): Promise<{ ok: boolean; rpmLimit?: number }>;
}

/**
 * Bands a `choice`/`score` answer's `confidence` field directly. Nouls have no
 * `confidence` (jev-spike §3.3/§7.4) — band those with {@link bandNoul} on the raw
 * probability's distance from 0.5 instead.
 */
export function bandConfidence(confidence: number): Band {
  if (confidence >= 0.9) return "auto";
  if (confidence >= 0.5) return "confirm";
  return "human";
}

/**
 * Nouls carry a single 0-1 probability and no `confidence` field. Treat distance
 * from the undecided midpoint (0.5) as an implied confidence: 1.0 at noul=0 or
 * noul=1, 0.0 at noul=0.5.
 */
export function bandNoul(noul: number): Band {
  const impliedConfidence = Math.abs(noul - 0.5) * 2;
  return bandConfidence(impliedConfidence);
}
