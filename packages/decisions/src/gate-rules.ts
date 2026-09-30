import type { JevAnswer } from "@openbot/contracts";

export interface SpawnGateInput {
  capsOk: boolean;
  answers: Record<string, JevAnswer>;
}

export interface SpawnGateResult {
  allow: boolean;
  suggestion: string | null;
}

/** Spawn gate decision rule (research §11.2). WS8's SpawnGate calls this after Jev. */
export function evaluateSpawnGate(input: SpawnGateInput): SpawnGateResult {
  const route = input.answers.route;
  const noul = (id: string): number => {
    const answer = input.answers[id];
    return answer?.type === "noul" ? answer.noul : 0;
  };
  const routeChoice = route?.type === "choice" ? route.choice : "cos_itself";
  const routeConfidence = route?.type === "choice" ? route.confidence : 0;

  const allow =
    input.capsOk &&
    (noul("user_requested") >= 0.8 ||
      (routeChoice === "new_bot" &&
        routeConfidence >= 0.7 &&
        noul("existing_can_do") <= 0.3 &&
        (noul("one_off") <= 0.4 || noul("substantial_work") >= 0.6) &&
        noul("duplicates_existing") <= 0.3 &&
        (noul("recurring_ownership") >= 0.7 ||
          noul("distinct_boundary") >= 0.7 ||
          noul("substantial_work") >= 0.6)));

  const suggestion = allow ? null : routeChoice === "new_bot" ? "cos_itself" : routeChoice;
  return { allow, suggestion };
}

export interface NotifyGateInput {
  capsOk: boolean;
  answers: Record<string, JevAnswer>;
}

export interface NotifyGateResult {
  deliver: boolean;
  push: boolean;
}

/** Notify gate decision rule (research §11.3, mapped to WS7 question ids). */
export function evaluateNotifyGate(input: NotifyGateInput): NotifyGateResult {
  const noul = (id: string): number => {
    const answer = input.answers[id];
    return answer?.type === "noul" ? answer.noul : 0;
  };

  const deliver =
    input.capsOk &&
    noul("valid_kind") >= 0.7 &&
    noul("chatter") <= 0.3 &&
    noul("duplicate_of_recent") <= 0.3;
  const push = deliver && noul("is_time_sensitive") >= 0.7;

  return { deliver, push };
}

/** Build a partial Jev answer for eval fixtures. */
export function choiceAnswer(choice: string, confidence: number): JevAnswer {
  return { type: "choice", choice, confidence, probabilities: { [choice]: confidence } };
}

export function noulAnswer(noul: number): JevAnswer {
  return { type: "noul", noul };
}
