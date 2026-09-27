import type { JevQuestion } from "@openbot/contracts";

/** Notify gate questions (research §11.3). WS8 owns the decision rule. */
export function buildNotifyQuestions(): Record<string, JevQuestion> {
  return {
    is_final_result: {
      type: "noul",
      instructions: "Reports a finished, requested outcome.",
    },
    needs_user_decision: {
      type: "noul",
      instructions: "Work is waiting on a choice only the user can make.",
    },
    is_blocker: {
      type: "noul",
      instructions: "Work is stuck on something only the user can fix.",
    },
    is_duplicate_or_noise: {
      type: "noul",
      instructions:
        "Repeats something recently delivered, or is progress chatter, an acknowledgement, or a plan.",
    },
    is_time_sensitive: {
      type: "noul",
      instructions:
        "Delay would cause real harm (deadline, expiring session, pending payment).",
    },
  };
}
