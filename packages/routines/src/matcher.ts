import { createHash } from "node:crypto";
import { bandNoul, type DecisionService, type Routine, type RoutineEventTrigger } from "@openbot/contracts";
import type { TriggerSourceEvent } from "@openbot/contracts";

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** JSON-path + regex filter (plan §4.1 deterministic filter syntax). */
export function matchesDeterministicFilter(
  payload: unknown,
  filter: RoutineEventTrigger["filter"],
): boolean {
  if (!filter || filter.length === 0) return true;
  const json = JSON.stringify(payload);
  for (const { path, regex } of filter) {
    const value = extractJsonPath(payload, path);
    const text = value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
    if (!new RegExp(regex).test(text)) return false;
  }
  return true;
}

function extractJsonPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export interface MatchResult {
  matched: boolean;
  matchDecisionId?: string;
  reason?: string;
}

/**
 * Matching pipeline (plan §5 WS12):
 * 1. Dedupe by payloadHash (caller checks repo first)
 * 2. Deterministic filter
 * 3. Jev `trigger` gate when `matchInstructions` is set
 */
export async function matchTriggerEvent(
  routine: Routine,
  event: TriggerSourceEvent,
  decisionService?: DecisionService,
): Promise<MatchResult> {
  if (routine.trigger.type !== "event") {
    return { matched: false, reason: "not an event trigger" };
  }
  const trigger = routine.trigger;

  if (trigger.eventType && event.source !== trigger.eventType) {
    const openbotType = (event.payload as { type?: string } | undefined)?.type;
    if (trigger.source === "openbot" && openbotType !== trigger.eventType) {
      return { matched: false, reason: "event type mismatch" };
    }
    if (trigger.source !== "openbot" && event.source !== trigger.source) {
      return { matched: false, reason: "source mismatch" };
    }
  }

  if (!matchesDeterministicFilter(event.payload, trigger.filter)) {
    return { matched: false, reason: "filter mismatch" };
  }

  if (!trigger.matchInstructions) {
    return { matched: true };
  }

  if (!decisionService) {
    // Plan §4.4: trigger matching falls back to deterministic filter only.
    return { matched: true };
  }

  const result = await decisionService.decide({
    purpose: "trigger",
    state: JSON.stringify({
      UNTRUSTED: {
        instructions: trigger.matchInstructions,
        payload: event.payload,
        routine: routine.name,
      },
    }),
    questions: {
      matches_trigger: {
        type: "noul",
        instructions: `Does this event match the routine "${routine.name}"? ${trigger.matchInstructions}`,
        criteria: { no: "does not match", yes: "matches" },
      },
    },
  });

  const answer = result.answers.matches_trigger;
  const noul = answer?.type === "noul" ? answer.noul : 0.5;
  const band = decisionService.band(Math.abs(noul - 0.5) * 2, "trigger");
  const matched = band === "auto";

  return {
    matched,
    matchDecisionId: result.decisionId,
    reason: matched ? undefined : `trigger gate band: ${band}`,
  };
}
