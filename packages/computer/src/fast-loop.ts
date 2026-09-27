import type {
  Action,
  ActionOp,
  Band,
  DecisionService,
  Observation,
  ObservedElement,
  Screen,
} from "@openbot/contracts";
import { bandForAnswer } from "@openbot/decisions";
import { buildComputerQuestions } from "@openbot/decisions";
import { buildDecisionState } from "@openbot/decisions";
import type { ComputerActionBroker } from "./broker.js";
import { DefaultComputerActionBroker } from "./broker.js";
import { isSensitiveLabel } from "./sensitive-target.js";

export type StepOutcome = "executed" | "escalated" | "blocked" | "done" | "takeover" | "denied";

export interface ComputerStepEvent {
  step: number;
  observation: Observation;
  action?: Action;
  decisionId?: string;
  opBand?: Band;
  targetBand?: Band;
  outcome: StepOutcome;
  reason?: string;
}

export interface TypeTextContext {
  goal: string;
  observation: Observation;
  target?: ObservedElement;
}

export interface FastLoopOptions {
  screen: Screen;
  decisionService: DecisionService;
  goal: string;
  botId: string;
  chainId: string;
  providerId: string;
  maxSteps?: number;
  startUrl?: string;
  broker?: ComputerActionBroker;
  onStep?: (event: ComputerStepEvent) => void;
  /** LLM hook for free-text entry when Jev picks `type` (plan §4.5). */
  textForType?: (ctx: TypeTextContext) => Promise<string | null>;
  /** Same observation hash repeated this many times triggers escalation. */
  stallThreshold?: number;
}

export interface FastLoopResult {
  status: "completed" | "failed" | "escalated" | "takeover";
  steps: number;
  lastObservation?: Observation;
  summary?: string;
}

const DEFAULT_MAX_STEPS = 50;
const DEFAULT_STALL_THRESHOLD = 3;

export async function runFastLoop(options: FastLoopOptions): Promise<FastLoopResult> {
  const {
    screen,
    decisionService,
    goal,
    botId,
    chainId,
    providerId,
    maxSteps = DEFAULT_MAX_STEPS,
    startUrl,
    broker: optionsBroker,
    onStep,
    textForType,
    stallThreshold = DEFAULT_STALL_THRESHOLD,
  } = options;

  const broker = optionsBroker ?? new DefaultComputerActionBroker();

  if (startUrl) {
    const nav = await screen.act({ op: "navigate", url: startUrl });
    if (!nav.ok) {
      return { status: "failed", steps: 0, summary: nav.reason ?? "navigation failed" };
    }
  }

  let steps = 0;
  const observationHashes: string[] = [];

  while (steps < maxSteps) {
    steps += 1;
    const observation = await screen.observe();
    const hash = hashObservation(observation);
    observationHashes.push(hash);
    const stallCount = countTrailingEqual(observationHashes, hash);
    if (stallCount >= stallThreshold) {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        outcome: "escalated",
        reason: "stall: observation unchanged",
      };
      onStep?.(event);
      return {
        status: "escalated",
        steps,
        lastObservation: observation,
        summary: event.reason,
      };
    }

    const state = buildDecisionState({
      goal,
      url: observation.url,
      title: observation.title,
      observed_elements: observation.elements.map((el) => ({
        index: el.index,
        role: el.role,
        name: el.label,
        value: el.value,
      })),
    });

    const indices = observation.elements.map((el) => String(el.index));
    const questions = buildComputerQuestions(indices);
    const decision = await decisionService.decide({
      purpose: "computer",
      state,
      questions,
    });

    const opAnswer = decision.answers.op;
    const targetAnswer = decision.answers.target_index;
    const destructiveAnswer = decision.answers.is_destructive;

    const opBand = bandForAnswer(opAnswer);
    const targetBand = bandForAnswer(targetAnswer);
    const op = parseChoice(opAnswer, "wait") as ActionOp;
    const targetChoice = parseChoice(targetAnswer, "none");

    if (op === "done") {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action: { op: "done" },
        decisionId: decision.decisionId,
        opBand,
        targetBand,
        outcome: "done",
      };
      onStep?.(event);
      return {
        status: "completed",
        steps,
        lastObservation: observation,
        summary: "goal satisfied",
      };
    }

    if (op === "blocked") {
      await screen.takeover(true);
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action: { op: "blocked" },
        decisionId: decision.decisionId,
        outcome: "takeover",
        reason: "blocked — user takeover requested",
      };
      onStep?.(event);
      return {
        status: "takeover",
        steps,
        lastObservation: observation,
        summary: event.reason,
      };
    }

    if (opBand === "human" || (targetChoice !== "none" && targetBand === "human")) {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        decisionId: decision.decisionId,
        opBand,
        targetBand,
        outcome: "escalated",
        reason: "confidence below confirm band",
      };
      onStep?.(event);
      return {
        status: "escalated",
        steps,
        lastObservation: observation,
        summary: event.reason,
      };
    }

    const targetIndex = targetChoice === "none" ? undefined : Number.parseInt(targetChoice, 10);
    const targetElement =
      targetIndex !== undefined && !Number.isNaN(targetIndex)
        ? observation.elements.find((el) => el.index === targetIndex)
        : undefined;

    const sensitiveLabel = targetElement ? isSensitiveLabel(targetElement.label) : false;
    const isDestructive =
      destructiveAnswer?.type === "noul" ? destructiveAnswer.noul >= 0.5 : false;

    let action: Action = { op, target: targetIndex, text: undefined };
    if (op === "type") {
      const text = textForType
        ? await textForType({ goal, observation, target: targetElement })
        : null;
      if (!text) {
        const event: ComputerStepEvent = {
          step: steps,
          observation,
          decisionId: decision.decisionId,
          opBand,
          targetBand,
          outcome: "escalated",
          reason: "type action needs text from engine",
        };
        onStep?.(event);
        return {
          status: "escalated",
          steps,
          lastObservation: observation,
          summary: event.reason,
        };
      }
      action = { ...action, text };
    }

    const brokerDecision = await broker.checkAction({
      botId,
      chainId,
      action,
      observation,
      providerId,
      isDestructive,
      sensitiveLabel,
    });
    if (brokerDecision === "deny") {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action,
        decisionId: decision.decisionId,
        outcome: "denied",
        reason: "broker denied action",
      };
      onStep?.(event);
      return { status: "failed", steps, lastObservation: observation, summary: event.reason };
    }
    if (brokerDecision === "ask") {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action,
        decisionId: decision.decisionId,
        outcome: "blocked",
        reason: "approval required",
      };
      onStep?.(event);
      return {
        status: "escalated",
        steps,
        lastObservation: observation,
        summary: "approval card required",
      };
    }

    const result = await screen.act(action);
    if (result.blocked) {
      await screen.takeover(true);
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action,
        decisionId: decision.decisionId,
        outcome: "takeover",
        reason: result.reason ?? "provider blocked",
      };
      onStep?.(event);
      return { status: "takeover", steps, lastObservation: observation, summary: event.reason };
    }

    if (!result.ok) {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action,
        decisionId: decision.decisionId,
        outcome: "escalated",
        reason: result.reason ?? "act failed",
      };
      onStep?.(event);
      return {
        status: "escalated",
        steps,
        lastObservation: observation,
        summary: event.reason,
      };
    }

    onStep?.({
      step: steps,
      observation,
      action,
      decisionId: decision.decisionId,
      opBand,
      targetBand,
      outcome: "executed",
    });
  }

  const lastObservation = await screen.observe();
  return {
    status: "escalated",
    steps,
    lastObservation,
    summary: "maxSteps reached",
  };
}

function parseChoice(
  answer: { type: string; choice?: string } | undefined,
  fallback: string,
): string {
  if (answer?.type === "choice" && answer.choice) return answer.choice;
  return fallback;
}

function hashObservation(observation: Observation): string {
  return JSON.stringify({
    url: observation.url,
    title: observation.title,
    elements: observation.elements.map((el) => [el.index, el.role, el.label, el.value]),
  });
}

function countTrailingEqual(values: string[], value: string): number {
  let count = 0;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== value) break;
    count += 1;
  }
  return count;
}
