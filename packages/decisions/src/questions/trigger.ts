import type { JevQuestion } from "@openbot/contracts";

export function buildTriggerQuestions(): Record<string, JevQuestion> {
  return {
    matches_trigger: {
      type: "noul",
      instructions:
        "Given `trigger` instructions and `payload`, does this event match what the routine owner wanted?",
    },
  };
}
