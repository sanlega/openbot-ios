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
import { buildComputerQuestions, COMPUTER_KEYS } from "@openbot/decisions";
import { buildDecisionState } from "@openbot/decisions";
import type { ComputerActionBroker } from "./broker.js";
import { DefaultComputerActionBroker } from "./broker.js";
import { isSensitiveLabel } from "./sensitive-target.js";

export type StepOutcome =
  "executed" | "escalated" | "blocked" | "done" | "takeover" | "denied" | "cancelled";

export interface ComputerStepEvent {
  step: number;
  observation: Observation;
  action?: Action;
  /** Label of the element the action targeted, for timelines. */
  targetLabel?: string;
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
  /**
   * Text for a `type` step. Jev picks the field; the engine that started the task
   * authors the text (Jev has no free-text output). May wait for the engine to
   * answer; resolving `null` escalates the task.
   */
  textForType?: (ctx: TypeTextContext) => Promise<string | null>;
  /** Extra instructions the engine added while the task runs (steering). */
  instructions?: () => string[];
  /** Checked before every step; true stops the loop as cancelled. */
  shouldStop?: () => boolean;
  /** Same observation hash repeated this many times triggers escalation. */
  stallThreshold?: number;
}

export interface FastLoopResult {
  status: "completed" | "failed" | "escalated" | "takeover" | "cancelled";
  steps: number;
  lastObservation?: Observation;
  summary?: string;
}

const DEFAULT_MAX_STEPS = 50;
const DEFAULT_STALL_THRESHOLD = 3;
const RECENT_STEPS_IN_STATE = 6;

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
    instructions,
    shouldStop,
    stallThreshold = DEFAULT_STALL_THRESHOLD,
  } = options;

  const broker = optionsBroker ?? new DefaultComputerActionBroker();
  const recent: string[] = [];
  const remember = (line: string) => {
    recent.push(line);
    if (recent.length > RECENT_STEPS_IN_STATE) recent.shift();
  };

  if (startUrl) {
    const nav = await screen.act({ op: "navigate", url: startUrl });
    if (!nav.ok) {
      return { status: "failed", steps: 0, summary: nav.reason ?? "navigation failed" };
    }
    remember(`opened ${startUrl}`);
  }

  let steps = 0;
  const observationHashes: string[] = [];

  while (steps < maxSteps) {
    if (shouldStop?.()) {
      return { status: "cancelled", steps, summary: "cancelled" };
    }
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
        reason: "The page stopped changing, so I stopped to avoid repeating myself.",
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }

    const extra = instructions?.() ?? [];
    const state = buildDecisionState({
      goal,
      ...(extra.length > 0 ? { instructions: extra } : {}),
      ...(recent.length > 0 ? { recent_steps: [...recent] } : {}),
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
    const decision = await decisionService.decide({ purpose: "computer", state, questions });

    if (shouldStop?.()) {
      return { status: "cancelled", steps, lastObservation: observation, summary: "cancelled" };
    }

    const opAnswer = decision.answers.op;
    const targetAnswer = decision.answers.target_index;
    const destructiveAnswer = decision.answers.is_destructive;

    const opBand = bandForAnswer(opAnswer);
    const targetBand = bandForAnswer(targetAnswer);
    const op = parseChoice(opAnswer, "wait") as ActionOp;
    const targetChoice = parseChoice(targetAnswer, "none");

    if (decision.provider !== "jev" && opBand === "human") {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        decisionId: decision.decisionId,
        outcome: "escalated",
        reason: "Jev is unavailable, so I stopped instead of guessing.",
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }

    if (op === "done") {
      onStep?.({
        step: steps,
        observation,
        action: { op: "done" },
        decisionId: decision.decisionId,
        opBand,
        targetBand,
        outcome: "done",
      });
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
        reason: "This step needs you (login, 2FA, CAPTCHA, or payment). Take over the screen.",
      };
      onStep?.(event);
      return { status: "takeover", steps, lastObservation: observation, summary: event.reason };
    }

    if (opBand === "human" || (targetChoice !== "none" && targetBand === "human")) {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        decisionId: decision.decisionId,
        opBand,
        targetBand,
        outcome: "escalated",
        reason: "I wasn't sure what to do next on this page.",
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }

    const targetIndex = targetChoice === "none" ? undefined : Number.parseInt(targetChoice, 10);
    const targetElement =
      targetIndex !== undefined && !Number.isNaN(targetIndex)
        ? observation.elements.find((el) => el.index === targetIndex)
        : undefined;

    // A target must be something that was actually observed on this page.
    if (targetIndex !== undefined && !targetElement) {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        decisionId: decision.decisionId,
        outcome: "escalated",
        reason: "The chosen element isn't on the page.",
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }

    const sensitiveLabel = targetElement ? isSensitiveLabel(targetElement.label) : false;
    const isDestructive =
      destructiveAnswer?.type === "noul" ? destructiveAnswer.noul >= 0.5 : false;

    let action: Action = { op, target: targetIndex };
    if (op === "key") {
      const key = parseChoice(decision.answers.key_name, "Enter");
      action = { op, text: (COMPUTER_KEYS as readonly string[]).includes(key) ? key : "Enter" };
    } else if (op === "scroll") {
      action = {
        op,
        text: parseChoice(decision.answers.scroll_direction, "down") === "up" ? "up" : "down",
      };
    } else if (op === "type") {
      if (!targetElement) {
        const event: ComputerStepEvent = {
          step: steps,
          observation,
          decisionId: decision.decisionId,
          outcome: "escalated",
          reason: "I needed a field to type into and couldn't find one.",
        };
        onStep?.(event);
        return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
      }
      const text = textForType
        ? await textForType({ goal, observation, target: targetElement })
        : null;
      if (shouldStop?.()) {
        return { status: "cancelled", steps, lastObservation: observation, summary: "cancelled" };
      }
      if (!text) {
        const event: ComputerStepEvent = {
          step: steps,
          observation,
          targetLabel: targetElement.label,
          decisionId: decision.decisionId,
          opBand,
          targetBand,
          outcome: "escalated",
          reason: `I needed text for "${targetElement.label}" and didn't get it.`,
        };
        onStep?.(event);
        return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
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
        targetLabel: targetElement?.label,
        decisionId: decision.decisionId,
        outcome: "denied",
        reason: "You denied this step.",
      };
      onStep?.(event);
      return { status: "failed", steps, lastObservation: observation, summary: event.reason };
    }
    if (brokerDecision === "ask") {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action,
        targetLabel: targetElement?.label,
        decisionId: decision.decisionId,
        outcome: "blocked",
        reason: "This step needs your approval.",
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }

    const result = await screen.act(action);
    if (result.blocked) {
      await screen.takeover(true);
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action,
        targetLabel: targetElement?.label,
        decisionId: decision.decisionId,
        outcome: "takeover",
        reason: result.reason ?? "The computer needs you to take over.",
      };
      onStep?.(event);
      return { status: "takeover", steps, lastObservation: observation, summary: event.reason };
    }

    if (!result.ok) {
      const event: ComputerStepEvent = {
        step: steps,
        observation,
        action,
        targetLabel: targetElement?.label,
        decisionId: decision.decisionId,
        outcome: "escalated",
        reason: result.reason ?? "The action failed.",
      };
      onStep?.(event);
      return { status: "escalated", steps, lastObservation: observation, summary: event.reason };
    }

    remember(describeAction(action, targetElement));
    onStep?.({
      step: steps,
      observation,
      action,
      targetLabel: targetElement?.label,
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
    summary: `Stopped after ${steps} steps without finishing.`,
  };
}

/** A short line Jev sees next step, so it doesn't redo what just happened. */
function describeAction(action: Action, target?: ObservedElement): string {
  const what = target ? ` "${target.label}"` : "";
  switch (action.op) {
    case "type":
      return `typed into${what}`;
    case "key":
      return `pressed ${action.text ?? "a key"}`;
    case "scroll":
      return `scrolled ${action.text ?? "down"}`;
    default:
      return `${action.op}${what}`;
  }
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
