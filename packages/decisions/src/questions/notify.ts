import type { JevQuestion } from "@openbot/contracts";

/** Notify gate questions (research §11.3). WS8 owns the decision rule. */
export function buildNotifyQuestions(): Record<string, JevQuestion> {
  return {
    valid_kind: {
      type: "noul",
      instructions:
        "Is `message.kind` one of result, decision, or blocker with substantive content in `message.body`?",
    },
    is_time_sensitive: {
      type: "noul",
      instructions:
        "Would waiting until the daily digest harm the user (deadline, blocker, outage)?",
    },
    duplicate_of_recent: {
      type: "noul",
      instructions:
        "Does `message.dedupe_key` match a message already delivered in the last 6 hours?",
    },
    chatter: {
      type: "noul",
      instructions:
        "Is this a progress update, acknowledgement, or plan rather than a result, decision, or blocker?",
    },
    user_asked: {
      type: "noul",
      instructions: "Did the user ask to be updated about this topic in `recent_user_messages`?",
    },
  };
}
