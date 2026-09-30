import {
  type Band,
  bandConfidence,
  type Bot,
  type DecideRequest,
  type RouteContext,
  type RouteDecision,
} from "@openbot/contracts";
import { buildRouteQuestions } from "./questions/route.js";
import { markUntrusted, buildDecisionState } from "./state-builders.js";
import type { DecisionServiceImpl } from "./decision-service.js";

export function buildRouteState(
  bot: Bot,
  task: string,
  ctx: RouteContext,
): Record<string, unknown> {
  return buildDecisionState({
    bot: {
      id: bot.id,
      name: bot.name,
      description: bot.description,
      routing: bot.routing,
      computer: bot.computer,
    },
    task: markUntrusted(task),
    currentEngine: ctx.currentEngine,
    currentEngineIdleMinutes: ctx.currentEngineIdleMinutes,
  });
}

export async function routeBot(
  service: Pick<DecisionServiceImpl, "decide" | "band">,
  bot: Bot,
  task: string,
  ctx: RouteContext,
): Promise<RouteDecision> {
  if (bot.routing.mode === "pinned" && bot.routing.engine && bot.routing.model) {
    return {
      engine: bot.routing.engine,
      model: bot.routing.model,
      effort: bot.routing.effort,
      band: "auto",
      decisionId: "dec_pinned",
    };
  }

  const questions = buildRouteQuestions(ctx);
  const req: DecideRequest = {
    purpose: "route",
    state: buildRouteState(bot, task, ctx),
    questions,
  };
  const result = await service.decide(req);

  const routeAnswer = result.answers.route;
  const complexityAnswer = result.answers.complexity;
  const needsComputerAnswer = result.answers.needs_computer;

  let engine = bot.routing.engine ?? ctx.availableEngines[0] ?? "claude";
  let model = bot.routing.model ?? "default";
  let band: Band = "human";

  if (routeAnswer?.type === "choice") {
    // Only the first ":" separates engine from model: model ids have their own (`ollama/qwen3:8b`).
    const sep = routeAnswer.choice.indexOf(":");
    const parsedEngine = sep > 0 ? routeAnswer.choice.slice(0, sep) : "";
    const parsedModel = sep > 0 ? routeAnswer.choice.slice(sep + 1) : "";
    if (parsedEngine && parsedModel) {
      engine = parsedEngine as RouteDecision["engine"];
      model = parsedModel;
    }
    band = service.band(routeAnswer.confidence, "route");
  }

  const complexity = complexityAnswer?.type === "score" ? complexityAnswer.score : undefined;
  const needsComputer =
    needsComputerAnswer?.type === "noul" ? needsComputerAnswer.noul >= 0.5 : undefined;

  let effort: RouteDecision["effort"] = "medium";
  if (complexity !== undefined) {
    if (complexity <= 0.5) effort = "low";
    else if (complexity >= 2.5) effort = "high";
  }

  if (band === "human") {
    band = bandConfidence(0.4);
  }

  return {
    engine,
    model,
    effort,
    complexity,
    needsComputer,
    band,
    decisionId: result.decisionId,
  };
}
