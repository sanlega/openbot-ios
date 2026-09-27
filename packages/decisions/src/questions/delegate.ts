import type { JevQuestion } from "@openbot/contracts";

/** Delegation: pick among roster, cos_itself, or new_bot. */
export function buildDelegateQuestions(rosterIds: string[]): Record<string, JevQuestion> {
  const criteria: Record<string, string> = {
    cos_itself: "The Chief of Staff should handle it in this session",
    new_bot: "Needs a new dedicated bot",
  };
  for (const id of rosterIds) {
    criteria[id] = `Existing bot ${id} from roster`;
  }

  return {
    route: {
      type: "choice",
      instructions: "Who should own the work described in `state.request`?",
      criteria,
    },
  };
}
