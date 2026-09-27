import type { JevQuestion } from "@openbot/contracts";

export function buildLoopQuestions(): Record<string, JevQuestion> {
  return {
    is_loop: {
      type: "noul",
      instructions:
        "Given `recent_messages` and `hop`, are the same bots repeating the same content without progress?",
    },
    should_pause: {
      type: "noul",
      instructions: "Should the chain pause and ask the user before more bot-to-bot messages?",
    },
  };
}
