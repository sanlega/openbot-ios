import type { JevQuestion } from "@openbot/contracts";

/** Spawn gate questions (research §11.2). WS8 owns the decision rule. */
export function buildSpawnQuestions(
  rosterCriteria: Record<string, string>,
): Record<string, JevQuestion> {
  return {
    route: {
      type: "choice",
      instructions: "Who should own the work described in `request`?",
      criteria: {
        ...rosterCriteria,
        cos_itself: "The Chief of Staff can do it within its current session",
        new_bot: "Needs a new, dedicated bot that no current bot can replace",
      },
    },
    user_requested: {
      type: "noul",
      instructions: "Did the user explicitly ask for a new bot in `recent_user_messages`?",
    },
    existing_can_do: {
      type: "noul",
      instructions:
        "Could an existing bot in `roster` do this, possibly with a small scope change?",
    },
    one_off: {
      type: "noul",
      instructions: "Is this a one-off task rather than recurring or long-running work?",
    },
    substantial_work: {
      type: "noul",
      instructions:
        "Is this substantial work (several steps, or more than a few minutes of effort) rather than a quick answer or lookup? Substantial work belongs to a bot so the Chief of Staff stays free.",
    },
    recurring_ownership: {
      type: "noul",
      instructions:
        "Does this need an owner over days or weeks (a recurring duty or ongoing project)?",
    },
    distinct_boundary: {
      type: "noul",
      instructions:
        "Does it need tools, accounts, permissions, an engine, or parallelism that no existing bot has?",
    },
    duplicates_existing: {
      type: "noul",
      instructions: "Would the new bot's responsibility overlap an existing bot's responsibility?",
    },
  };
}
