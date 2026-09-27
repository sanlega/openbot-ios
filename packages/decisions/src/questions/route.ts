import type { JevQuestion } from "@openbot/contracts";
import type { RouteContext } from "@openbot/contracts";

/** Route question set (plan WS7 / research §10): engine+model choice, complexity, needs_computer. */
export function buildRouteQuestions(ctx: RouteContext): Record<string, JevQuestion> {
  const criteria: Record<string, string> = {};
  for (const engine of ctx.availableEngines) {
    const models = ctx.modelsCatalog[engine] ?? [];
    for (const model of models) {
      const key = `${engine}:${model}`;
      criteria[key] = `${engine} engine using ${model}`;
    }
  }

  return {
    route: {
      type: "choice",
      instructions:
        "Given the bot profile and task in `state`, which engine and model should run this turn?",
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
