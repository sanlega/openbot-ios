import {
  type Band,
  bandConfidence,
  bandNoul,
  type DecideRequest,
  type JevAnswer,
  type JevQuestion,
  type Purpose,
} from "@openbot/contracts";
import { synthesizeAnswer } from "./answer-synthesis.js";

/** Purposes that may use the optional LLM one-shot fallback (plan WS7). */
export const LLM_FALLBACK_PURPOSES = new Set<Purpose>(["route", "triage", "delegate"]);

export interface LlmFallback {
  answer(req: DecideRequest): Promise<Record<string, JevAnswer> | null>;
}

export interface ConservativeFallbackContext {
  purpose: Purpose;
  state: DecideRequest["state"];
  questions: Record<string, JevQuestion>;
}

/**
 * Conservative degradation when Jev is unavailable (plan §4.4 / research §11.3):
 * spawns refused unless user_requested; notify only for valid kinds; risk never auto;
 * trigger falls back to deterministic filter (matches_trigger = false).
 */
export function conservativeFallbackAnswers(
  ctx: ConservativeFallbackContext,
): Record<string, JevAnswer> {
  const { purpose, state, questions } = ctx;
  const stateObj = typeof state === "string" ? { text: state } : (state as Record<string, unknown>);

  switch (purpose) {
    case "spawn":
      return conservativeSpawnAnswers(questions, stateObj);
    case "notify":
      return conservativeNotifyAnswers(questions, stateObj);
    case "risk":
      return conservativeRiskAnswers(questions);
    case "trigger":
      return { matches_trigger: { type: "noul", noul: 0 } };
    case "computer":
      return conservativeComputerAnswers(questions);
    case "loop":
      return {
        is_loop: { type: "noul", noul: 0.8 },
        should_pause: { type: "noul", noul: 0.8 },
      };
    default:
      return Object.fromEntries(
        Object.entries(questions).map(([id, question]) => [id, synthesizeAnswer(question)]),
      );
  }
}

/**
 * Without Jev the computer loop must not act: every choice comes back with zero
 * confidence (the "human" band), so the loop stops and escalates instead of
 * clicking whatever option happened to be listed first.
 */
function conservativeComputerAnswers(
  questions: Record<string, JevQuestion>,
): Record<string, JevAnswer> {
  const answers: Record<string, JevAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === "choice") {
      const choice = id === "op" ? "wait" : id === "target_index" ? "none" : "";
      answers[id] = { type: "choice", choice, confidence: 0, probabilities: {} };
    } else if (question.type === "noul") {
      answers[id] = { type: "noul", noul: 1 };
    } else {
      answers[id] = synthesizeAnswer(question);
    }
  }
  return answers;
}

function conservativeSpawnAnswers(
  questions: Record<string, JevQuestion>,
  state: Record<string, unknown>,
): Record<string, JevAnswer> {
  const userRequested = Boolean(state.user_requested);
  const answers: Record<string, JevAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === "choice" && id === "route") {
      answers[id] = {
        type: "choice",
        choice: userRequested ? "new_bot" : "cos_itself",
        confidence: userRequested ? 0.6 : 0.95,
        probabilities: {},
      };
      continue;
    }
    if (question.type === "noul" && id === "user_requested") {
      answers[id] = { type: "noul", noul: userRequested ? 0.9 : 0.1 };
      continue;
    }
    if (question.type === "noul") {
      answers[id] = { type: "noul", noul: userRequested ? 0.5 : 0.9 };
      continue;
    }
    answers[id] = synthesizeAnswer(question);
  }
  return answers;
}

function conservativeNotifyAnswers(
  questions: Record<string, JevQuestion>,
  state: Record<string, unknown>,
): Record<string, JevAnswer> {
  const message = (state.message as Record<string, unknown> | undefined) ?? {};
  const kind = String(message.kind ?? "");
  const validKind = kind === "result" || kind === "decision" || kind === "blocker";
  const answers: Record<string, JevAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === "noul" && id === "is_final_result") {
      answers[id] = { type: "noul", noul: kind === "result" ? 0.8 : 0.1 };
      continue;
    }
    if (question.type === "noul" && id === "needs_user_decision") {
      answers[id] = { type: "noul", noul: kind === "decision" ? 0.8 : 0.1 };
      continue;
    }
    if (question.type === "noul" && id === "is_blocker") {
      answers[id] = { type: "noul", noul: kind === "blocker" ? 0.8 : 0.1 };
      continue;
    }
    if (question.type === "noul" && id === "is_duplicate_or_noise") {
      answers[id] = { type: "noul", noul: validKind ? 0.2 : 0.9 };
      continue;
    }
    if (question.type === "noul") {
      answers[id] = { type: "noul", noul: 0.5 };
      continue;
    }
    answers[id] = synthesizeAnswer(question);
  }
  return answers;
}

function conservativeRiskAnswers(
  questions: Record<string, JevQuestion>,
): Record<string, JevAnswer> {
  const answers: Record<string, JevAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === "noul" && id === "external_side_effect") {
      answers[id] = { type: "noul", noul: 0.8 };
      continue;
    }
    // The permission broker asks `external_side_effect` as an ordered score
    // (none..major); without Jev, assume the most severe level so it never auto-allows.
    if (question.type === "score" && id === "external_side_effect") {
      const top = question.criteria.length - 1;
      const probabilities: Record<string, number> = {};
      question.criteria.forEach((_desc, i) => {
        probabilities[String(i)] = i === top ? 1 : 0;
      });
      answers[id] = { type: "score", score: top, confidence: 0.3, legend: {}, probabilities };
      continue;
    }
    if (question.type === "score" && id === "severity") {
      answers[id] = {
        type: "score",
        score: 3,
        confidence: 0.95,
        legend: {},
        probabilities: {},
      };
      continue;
    }
    answers[id] = synthesizeAnswer(question);
  }
  return answers;
}

export function bandForAnswer(answer: JevAnswer | undefined): Band {
  if (!answer) return "human";
  if (answer.type === "noul") return bandNoul(answer.noul);
  return bandConfidence(answer.confidence);
}

export function outcomeForPurpose(purpose: Purpose, band: Band): "allow" | "deny" | "ask" | "n/a" {
  if (purpose === "risk") {
    if (band === "auto") return "ask";
    if (band === "confirm") return "ask";
    return "ask";
  }
  if (band === "auto") return "allow";
  if (band === "confirm") return "ask";
  return "deny";
}
