import type { JevQuestion } from "@openbot/contracts";

/** Inbound message triage bundle (research §7 row 1). */
export function buildTriageQuestions(): Record<string, JevQuestion> {
  return {
    intent: {
      type: "choice",
      instructions: "What kind of user request is in `state.message`?",
      criteria: {
        status_lookup: "Asking for status, lists, or information already in OpenBot",
        new_task: "Requesting new work to be done",
        follow_up: "Following up on prior work",
        chit_chat: "Small talk or acknowledgment with no work requested",
      },
    },
    urgency: {
      type: "score",
      instructions: "How time-sensitive is the message in `state.message`?",
      criteria: ["Not urgent", "Normal", "Soon", "Immediate"],
    },
    needs_engine: {
      type: "noul",
      instructions: "Does answering require an engine turn (planning, tools, or generation)?",
    },
    existing_can_do: {
      type: "noul",
      instructions: "Can an existing bot in `state.roster` handle this without spawning?",
    },
    recurring_ownership: {
      type: "noul",
      instructions: "Does this imply ongoing ownership (recurring duty or long project)?",
    },
  };
}
