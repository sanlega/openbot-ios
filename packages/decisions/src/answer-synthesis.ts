import type { JevAnswer, JevQuestion } from "@openbot/contracts";

/**
 * Deterministic, scriptless answer for a question, shared by `FakeJevServer`
 * (HTTP) and `FakeDecisionService` (in-process). Never used against a real
 * Jev endpoint — real answers always come from `api.typesafe.ai`.
 */
export function synthesizeAnswer(question: JevQuestion): JevAnswer {
  switch (question.type) {
    case "choice": {
      const options = Object.keys(question.criteria);
      const choice = options[0] ?? "";
      const probabilities: Record<string, number> = {};
      for (const option of options) probabilities[option] = option === choice ? 1 : 0;
      return { type: "choice", choice, confidence: 1, probabilities };
    }
    case "score": {
      const legend: Record<string, string> = {};
      question.criteria.forEach((desc, i) => {
        legend[String(i)] = desc;
      });
      const midIndex = Math.floor((question.criteria.length - 1) / 2);
      const probabilities: Record<string, number> = {};
      question.criteria.forEach((_desc, i) => {
        probabilities[String(i)] = i === midIndex ? 1 : 0;
      });
      return { type: "score", score: midIndex, confidence: 0.75, legend, probabilities };
    }
    case "noul":
      return { type: "noul", noul: 0.5 };
  }
}
