import type { JevQuestion } from "@openbot/contracts";
import type { RouteContext } from "@openbot/contracts";

const MAX_MODELS_PER_ENGINE = 8;

/** Route question set (plan WS7 / research §10): engine+model choice, complexity, needs_computer. */
export function buildRouteQuestions(ctx: RouteContext): Record<string, JevQuestion> {
  const criteria: Record<string, string> = {};
  const local = new Set(ctx.localModels ?? []);
  for (const engine of ctx.availableEngines) {
    const info = ctx.engineInfo?.[engine];
    const label = info?.label ?? engine;
    const summary = info?.summary ? ` (${info.summary})` : "";
    // Engines like OpenCode list hundreds of models: offer the first few, which are the ones
    // the engine puts first (local models, then its own defaults).
    const models = (ctx.modelsCatalog[engine] ?? []).slice(0, MAX_MODELS_PER_ENGINE);
    for (const model of models) {
      const key = `${engine}:${model}`;
      criteria[key] = local.has(key)
        ? `${label} using ${model}, a local model on this computer: free and private, but slow and weak at multi-step tool use`
        : `${label} engine using ${model}${summary}`;
    }
  }

  return {
    route: {
      type: "choice",
      instructions:
        "Given the bot profile and task in `state`, which engine and model should run this turn? " +
        "If `state.currentEngine` is set, that engine's session already holds this conversation's " +
        "memory — switching engines starts a blank session with no memory of it, even for a short " +
        'follow-up like "continue". The lower `state.currentEngineIdleMinutes` is, the stronger that ' +
        "cost: strongly prefer staying on `state.currentEngine` unless `state.task` is clearly a new, " +
        "unrelated request that doesn't build on the current conversation. Local models suit only " +
        "trivial tasks, unless the bot's profile asks for local or private work.",
      criteria,
    },
    complexity: {
      type: "score",
      instructions: "How complex is the task described in `state.task`?",
      criteria: [
        "Trivial: lookup, status, or a single short reply",
        "Moderate: multi-step reasoning within one domain",
        "Complex: multi-file refactor, research, or cross-domain work",
        "Very complex: architecture, long-running project, or high-risk changes",
      ],
    },
    needs_computer: {
      type: "noul",
      instructions:
        "Does completing the task in `state.task` require interacting with a GUI or browser?",
    },
  };
}
