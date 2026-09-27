import type { JevQuestion } from "@openbot/contracts";

/** WS9 fast-loop action pick (plan §4.5 / research §10). */
export function buildComputerQuestions(
  observedIndices: string[],
  ops: string[] = ["click", "type", "select", "wait", "done"],
): Record<string, JevQuestion> {
  const targetCriteria: Record<string, string> = { none: "No element applies; wait or escalate" };
  for (const index of observedIndices) {
    targetCriteria[index] = `Observed element at index ${index}`;
  }

  const opCriteria: Record<string, string> = {};
  for (const op of ops) {
    opCriteria[op] = `Perform ${op} on the chosen target`;
  }

  return {
    op: {
      type: "choice",
      instructions: "Given `goal` and `observed_elements`, which operation should run next?",
      criteria: opCriteria,
    },
    target_index: {
      type: "choice",
      instructions: "Which observed element index should be the target?",
      criteria: targetCriteria,
    },
    is_destructive: {
      type: "noul",
      instructions: "Would the chosen action pay, send, delete, or submit irreversibly?",
    },
  };
}
