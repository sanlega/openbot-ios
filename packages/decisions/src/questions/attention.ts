import type { JevQuestion } from "@openbot/contracts";

export function buildAttentionQuestions(): Record<string, JevQuestion> {
  return {
    needs_attention: {
      type: "noul",
      instructions:
        "Does `state` describe something the user must see soon (approval, blocker, handoff)?",
    },
    can_wait_for_digest: {
      type: "noul",
      instructions: "Can this wait until the daily digest without harming the user?",
    },
  };
}
