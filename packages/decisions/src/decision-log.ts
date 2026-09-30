import { monotonicFactory } from "ulid";
import {
  type Band,
  type Decision,
  type DecisionOutcome,
  type DecideRequest,
  type DecideResult,
  newId,
  type Purpose,
} from "@openbot/contracts";
import { bandForAnswer, outcomeForPurpose } from "./fallbacks.js";
import { hashState } from "./state-builders.js";

const ulid = monotonicFactory();

export interface DecisionLogEntryInput {
  purpose: Purpose;
  provider: DecideResult["provider"];
  model: string;
  state: DecideRequest["state"];
  answers: DecideResult["answers"];
  requestId?: string;
  primaryAnswerId?: string;
}

export interface DecisionLogStore {
  insert(decision: Decision): void;
  list(): Decision[];
}

/** In-memory decision log for tests; production uses {@link DecisionsRepo}. */
export class InMemoryDecisionLog implements DecisionLogStore {
  readonly entries: Decision[] = [];

  insert(decision: Decision): void {
    this.entries.push(decision);
  }

  list(): Decision[] {
    return [...this.entries];
  }
}

export class DecisionLog {
  constructor(private readonly store: DecisionLogStore = new InMemoryDecisionLog()) {}

  record(input: DecisionLogEntryInput): string {
    const id = newId("decision");
    const primary = input.primaryAnswerId
      ? input.answers[input.primaryAnswerId]
      : Object.values(input.answers)[0];
    const band: Band = bandForAnswer(primary);
    const outcome: DecisionOutcome = outcomeForPurpose(input.purpose, band);

    this.store.insert({
      id,
      purpose: input.purpose,
      provider: input.provider,
      model: input.model,
      stateHash: hashState(input.state),
      answers: input.answers,
      band,
      outcome,
      requestId: input.requestId,
      createdAt: new Date().toISOString(),
    });

    return id;
  }

  list(): Decision[] {
    return this.store.list();
  }
}

export function primaryAnswerIdForPurpose(
  purpose: Purpose,
  questions: Record<string, unknown>,
): string | undefined {
  switch (purpose) {
    case "route":
    case "delegate":
    case "spawn":
      return "route";
    case "risk":
      return "external_side_effect";
    case "trigger":
      return "matches_trigger";
    case "computer":
      return "action" in questions
        ? "action"
        : "op" in questions
          ? "op"
          : Object.keys(questions)[0];
    default:
      return Object.keys(questions)[0];
  }
}

/** Exported for tests that need stable ids without touching ULID clock. */
export function nextDecisionId(): string {
  return `dec_${ulid()}`;
}
