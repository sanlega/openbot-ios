import type {
  Action,
  ActionOp,
  Band,
  DecisionService,
  Observation,
  ObservedElement,
  Screen,
} from "@openbot/contracts";
import { bandForAnswer, UNCONFIGURED_MODEL } from "@openbot/decisions";
import { buildComputerActionQuestions } from "@openbot/decisions";
import { buildCandidates, hasPopup, type Candidate } from "./candidates.js";
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

export type ComputerPhase = "opening" | "looking" | "deciding" | "acting";

/** Why only the user can continue. */
export type BlockerKind = "login" | "code" | "captcha" | "payment" | "other";

export interface BlockedContext {
  kind: BlockerKind;
  observation: Observation;
  reason: string;
}

export interface TypeTextContext {
  goal: string;
  observation: Observation;
  target?: ObservedElement;
}

/**
 * What `textForType` returns when the field no longer needs typing: the user filled it (they
 * signed in themselves inside the virtual machine). The loop looks at the page again.
 */
export const SKIP_TYPING = "openbot:skip-typing:6f1c";

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
  /** Applied to every observation before Jev, events or hashing see it (masks typed secrets). */
  redactObservation?: (observation: Observation) => Observation;
  /** Extra instructions the engine added while the task runs (steering). */
  instructions?: () => string[];
  /** Checked before every step; true stops the loop as cancelled. */
  shouldStop?: () => boolean;
  /** What the loop is doing right now, for progress displays. */
  onPhase?: (phase: ComputerPhase) => void;
  /** Per-phase limits in ms (defaults: observe 15 s, decide 20 s, act 30 s). */
  timeouts?: Partial<Record<"observe" | "decide" | "act", number>>;
  /** Same observation hash repeated this many times triggers escalation. */
  stallThreshold?: number;
  /** Pause after a click, key or typing so the next look sees the new page. */
  settleMs?: number;
  /**
   * A step only the user can do (sign-in, a code, a CAPTCHA). Resolves "resume" when it is done
   * (the loop carries on from the page as it is now) or "stop" to end the task there.
   * Without it the loop stops with status `takeover`.
   */
  onBlocked?: (ctx: BlockedContext) => Promise<"resume" | "stop">;
  /** True when the vault has a login for this page, so a sign-in form is not a blocker. */
  hasSavedLogin?: (url: string | undefined) => Promise<boolean>;
  /** Consecutive setbacks (unsure pick, failed action, stalled page) tried around before stopping. */
  maxRecoveries?: number;
}

export interface FastLoopResult {
  status: "completed" | "failed" | "escalated" | "takeover" | "cancelled";
  steps: number;
  lastObservation?: Observation;
  summary?: string;
}

const DEFAULT_MAX_STEPS = 120;
const DEFAULT_MAX_RECOVERIES = 4;
/** Choices that leave the page as it is; not offered again on a page that stalled. */
const IDLE_CHOICES = new Set(["wait", "scroll_down", "scroll_up"]);
const DEFAULT_STALL_THRESHOLD = 3;
const RECENT_STEPS_IN_STATE = 6;

/**
 * Runs the loop; when it stops short (stalled, out of steps, stuck on a
 * target) while a page is in view, Jev checks that page against the goal once,
 * so a task that already got there isn't reported as a failure.
 */
export async function runFastLoop(options: FastLoopOptions): Promise<FastLoopResult> {
  // What was done, for the end check ("typed into “Search”", "click “Ada Lovelace”").
  const history: string[] = [];
  const result = await runSteps({
    ...options,
    onStep: (event) => {
      if (event.outcome === "executed" && event.action) {
        history.push(
          `${event.action.op}${event.targetLabel ? ` “${event.targetLabel.slice(0, 60)}”` : ""}`,
        );
      }
      options.onStep?.(event);
    },
  });
  if (result.status !== "escalated" && result.status !== "failed") return result;
  if (!result.lastObservation || options.shouldStop?.()) return result;
  const met = await goalAlreadyMet(options, result.lastObservation, history.slice(-6));
  if (!met) return result;
  options.onStep?.({
    step: result.steps + 1,
    observation: result.lastObservation,
    action: { op: "done" },
    decisionId: met.decisionId,
    outcome: "done",
    reason: "Jev checked the page: the goal is already done.",
  });
  return {
    status: "completed",
    steps: result.steps + 1,
    lastObservation: result.lastObservation,
    summary: "goal satisfied (checked by Jev)",
  };
}

const GOAL_CHECK_CONFIDENCE = 0.85;

async function goalAlreadyMet(
  options: FastLoopOptions,
  observation: Observation,
  history: string[],
): Promise<{ decisionId: string } | undefined> {
  const state = buildDecisionState({
    goal: options.goal,
    ...(history.length > 0 ? { steps_already_done: history } : {}),
    url: observation.url,
    title: observation.title,
    observed_elements: observation.elements.map((el) => ({
      index: el.index,
      role: el.role,
      name: el.label,
      value: el.value,
    })),
  });
  try {
    const decision = await withDeadline(
      options.decisionService.decide({
        purpose: "computer",
        state,
        questions: {
          goal_met: {
            type: "choice",
            instructions:
              "Is `goal` already accomplished? Judge by where the browser is now (`url`, `title`) and `steps_already_done`: if the page the goal asks for is open, the earlier steps (searching, clicking) are done too.",
            criteria: {
              yes: "The page shows the goal is done (e.g. the requested page is open or the result is visible)",
              no: "The goal is not done yet, or the page doesn't show it",
            },
          },
        },
      }),
      options.timeouts?.decide ?? 20_000,
      "goal check timed out",
    );
    const answer = decision.answers.goal_met;
    if (decision.provider !== "jev") return undefined;
    if (answer?.type !== "choice" || answer.choice !== "yes") return undefined;
    if ((answer.confidence ?? 0) < GOAL_CHECK_CONFIDENCE) return undefined;
    return { decisionId: decision.decisionId };
  } catch {
    return undefined;
  }
}

async function runSteps(options: FastLoopOptions): Promise<FastLoopResult> {
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
    onPhase,
    timeouts = {},
    stallThreshold = DEFAULT_STALL_THRESHOLD,
    // The fake computer changes pages instantly; real browsers need a moment.
    settleMs = options.providerId === "fake" ? 0 : 700,
  } = options;
  const limit = { observe: 15_000, decide: 20_000, act: 30_000, ...timeouts };
  const observe = async () => {
    onPhase?.("looking");
    const raw = await withDeadline(
      screen.observe(),
      limit.observe,
      "Looking at the screen took too long.",
    );
    return options.redactObservation ? options.redactObservation(raw) : raw;
  };

  const broker = optionsBroker ?? new DefaultComputerActionBroker();
  const recent: string[] = [];
  const remember = (line: string) => {
    recent.push(line);
    if (recent.length > RECENT_STEPS_IN_STATE) recent.shift();
  };

  if (startUrl) {
    onPhase?.("opening");
    const nav = await withDeadline(
      screen.act({ op: "navigate", url: startUrl }),
      limit.act,
      "Opening the page took too long.",
    ).catch((error: unknown) => ({ ok: false, reason: String((error as Error).message ?? error) }));
    if (!nav.ok) {
      return { status: "failed", steps: 0, summary: nav.reason ?? "navigation failed" };
    }
    remember(`opened ${startUrl}`);
  }

  let steps = 0;
  let observationHashes: string[] = [];
  const closedNotices = new Set<string>();
  // Element actions that errored or changed nothing on a page: not offered again there.
  const failed = new Set<string>();
  const stalledPages = new Set<string>();
  let lastExecuted: string | undefined;
  // The page as it was when a real step ran; a different page next time counts as progress.
  let actionHash: string | undefined;
  let troubles = 0;
  const maxRecoveries = options.maxRecoveries ?? DEFAULT_MAX_RECOVERIES;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const giveUp = (
    observation: Observation | undefined,
    reason: string,
    extra: Partial<ComputerStepEvent> = {},
  ): FastLoopResult => {
    if (observation) {
      onStep?.({ step: steps, observation, outcome: "escalated", reason, ...extra });
    }
    return { status: "escalated", steps, lastObservation: observation, summary: reason };
  };

  /**
   * Something didn't work (unsure pick, failed action, stalled page). Try another way around it
   * (wait for the page, close a popup, scroll) before giving up; false when the tries ran out.
   */
  const recover = async (observation: Observation, reason: string): Promise<boolean> => {
    troubles += 1;
    if (troubles > maxRecoveries) return false;
    const action: Action =
      troubles === 1
        ? { op: "wait" }
        : troubles === 2 && hasPopup(observation)
          ? { op: "key", text: "Escape" }
          : { op: "scroll", text: troubles % 2 === 0 ? "down" : "up" };
    onPhase?.("acting");
    await withDeadline(screen.act(action), limit.act, "timeout").catch(() => undefined);
    await sleep(settleMs * 2);
    remember(`${reason}; tried ${describeAction(action)}`);
    onStep?.({
      step: steps,
      observation,
      action,
      outcome: "executed",
      reason: `Trying another way: ${reason}`,
    });
    return true;
  };

  /** Hands the screen to the user for a step only they can do, and waits for them to finish. */
  const pauseForUser = async (
    kind: BlockerKind,
    observation: Observation,
    decisionId: string | undefined,
    detail?: string,
  ): Promise<FastLoopResult | undefined> => {
    await screen.takeover(true);
    const reason = detail ?? blockerReason(kind);
    onStep?.({
      step: steps,
      observation,
      action: { op: "blocked" },
      decisionId,
      outcome: "takeover",
      reason,
    });
    const verdict = options.onBlocked
      ? await options.onBlocked({ kind, observation, reason })
      : "stop";
    if (shouldStop?.()) {
      return { status: "cancelled", steps, lastObservation: observation, summary: "cancelled" };
    }
    if (verdict === "stop") {
      return { status: "takeover", steps, lastObservation: observation, summary: reason };
    }
    await screen.takeover(false);
    observationHashes = [];
    troubles = 0;
    remember(`the user finished the ${kind} step; carry on from the page as it is now`);
    return undefined;
  };

  while (steps < maxSteps) {
    if (shouldStop?.()) {
      return { status: "cancelled", steps, summary: "cancelled" };
    }
    steps += 1;
    let observation: Observation;
    try {
      observation = await observe();
    } catch (error) {
      // A page mid-navigation often can't be read for a moment.
      troubles += 1;
      if (troubles > maxRecoveries) return giveUp(undefined, messageOf(error));
      await sleep(Math.max(settleMs, 500));
      continue;
    }
    const hash = hashObservation(observation);
    if (actionHash !== undefined && hash !== actionHash) troubles = 0;
    actionHash = undefined;
    observationHashes.push(hash);
    const stallCount = countTrailingEqual(observationHashes, hash);
    if (stallCount >= stallThreshold) {
      // Whatever ran last did nothing here: don't offer it again on this page.
      if (lastExecuted) failed.add(lastExecuted);
      // Waiting and scrolling did not change this page either: offer only its controls next time.
      stalledPages.add(hash);
      observationHashes = [];
      if (await recover(observation, "the page stopped changing")) continue;
      return giveUp(observation, "The page stopped changing and nothing I tried moved it.");
    }

    // Cookie notices block the page and aren't part of any goal: close them
    // without asking Jev (once per notice), still through the broker.
    const consent = consentButton(observation);
    const consentKey = consent ? `${observation.url ?? ""}|${consent.label}` : "";
    if (consent && !closedNotices.has(consentKey)) {
      closedNotices.add(consentKey);
      const action: Action = { op: "click", target: consent.index };
      const check = await broker.checkAction({
        botId,
        chainId,
        action,
        observation,
        providerId,
        isDestructive: false,
        sensitiveLabel: false,
      });
      if (check === "allow") {
        onPhase?.("acting");
        const result = await withDeadline(screen.act(action), limit.act, "timeout").catch(() => ({
          ok: false,
        }));
        if (result.ok) {
          remember(`closed the cookie notice ("${consent.label}")`);
          onStep?.({
            step: steps,
            observation,
            action,
            targetLabel: consent.label,
            outcome: "executed",
            reason: "Closed a cookie notice",
          });
          continue;
        }
      }
    }

    // A sign-in form with a saved login is not a blocker: the host types it.
    const savedLogin =
      looksLikeSignIn(observation) && options.hasSavedLogin
        ? await options.hasSavedLogin(observation.url).catch(() => false)
        : false;
    const extra = instructions?.() ?? [];
    const state = buildDecisionState({
      goal,
      ...(extra.length > 0 ? { instructions: extra } : {}),
      ...(recent.length > 0 ? { recent_steps: [...recent] } : {}),
      ...(savedLogin
        ? {
            saved_login_available:
              "A saved username and password will be typed into the sign-in fields for you: fill them, do not stop.",
          }
        : {}),
      url: observation.url,
      title: observation.title,
      observed_elements: observation.elements.map((el) => ({
        index: el.index,
        role: el.role,
        name: el.label,
        value: el.value,
      })),
    });

    const candidates = buildCandidates(observation, {
      goal,
      typedRecently: recent.length > 0 && recent[recent.length - 1]!.startsWith("typed into"),
      allowBlocked: !savedLogin,
    })
      .filter((c) => !c.element || !failed.has(`${observation.url ?? ""}|${c.id}`))
      .filter((c) => !stalledPages.has(hash) || !IDLE_CHOICES.has(c.id));
    const questions = buildComputerActionQuestions(candidates);
    onPhase?.("deciding");
    let decision: Awaited<ReturnType<DecisionService["decide"]>>;
    try {
      decision = await withDeadline(
        decisionService.decide({ purpose: "computer", state, questions }),
        limit.decide,
        "Jev didn't answer in time, so I stopped instead of guessing.",
      );
    } catch (error) {
      if (await recover(observation, messageOf(error))) continue;
      return giveUp(observation, messageOf(error));
    }

    if (shouldStop?.()) {
      return { status: "cancelled", steps, lastObservation: observation, summary: "cancelled" };
    }

    const actionAnswer = decision.answers.action;
    const destructiveAnswer = decision.answers.is_destructive;
    const opBand = bandForAnswer(actionAnswer);
    const targetBand = opBand;
    const choiceId = parseChoice(actionAnswer, "");
    let chosen = candidates.find((c) => c.id === choiceId);

    if (decision.provider !== "jev" && opBand === "human") {
      const reason =
        decision.model === UNCONFIGURED_MODEL
          ? "No Jev (TypeSafe) key is set, so I stopped instead of guessing. Add it in Settings → Jev."
          : "Jev is unavailable, so I stopped instead of guessing.";
      // A missing key won't fix itself; an outage might.
      if (decision.model !== UNCONFIGURED_MODEL && (await recover(observation, reason))) continue;
      return giveUp(observation, reason, { decisionId: decision.decisionId });
    }

    // Confident enough? Reversible steps (a plain click, scrolling, Escape) may
    // run when Jev clearly leans to one option; typing, submitting, "done" and
    // "blocked" need the usual confidence.
    const lead = clearLead(actionAnswer);
    const sure =
      opBand !== "human" ||
      (chosen?.reversible === true &&
        !(chosen.element && isSensitiveLabel(chosen.element.label)) &&
        lead.top >= 0.3 &&
        lead.top >= lead.second * 1.5);
    if (!chosen && choiceId && opBand !== "human") {
      // A target must be something that was actually observed on this page.
      const reason = "The chosen element isn't on the page.";
      if (await recover(observation, reason)) continue;
      return giveUp(observation, reason, { decisionId: decision.decisionId });
    }
    let forced = false;
    if (!chosen || !sure) {
      // The first doubt gets a second look (the page may still be moving); after that, go with
      // the most likely harmless option rather than stopping.
      const guess = troubles >= 1 ? bestGuess(actionAnswer, candidates) : undefined;
      if (guess) {
        chosen = guess;
        forced = true;
        remember("not sure what comes next; going with the most likely option");
      } else {
        const likely = topChoices(actionAnswer, candidates, 3);
        const reason = likely
          ? `I wasn't sure what to do next on this page. Most likely: ${likely}.`
          : "I wasn't sure what to do next on this page.";
        if (await recover(observation, "not sure what to do next")) continue;
        return giveUp(observation, reason, {
          decisionId: decision.decisionId,
          opBand,
          targetBand,
        });
      }
    }
    if (!chosen) return giveUp(observation, "I wasn't sure what to do next on this page.");

    const op = chosen.action.op as ActionOp;
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
      const ended = await pauseForUser(
        classifyBlocker(observation),
        observation,
        decision.decisionId,
      );
      if (ended) return ended;
      continue;
    }

    const targetElement = chosen.element;
    // Opening a link, scrolling or waiting only moves around; the risk is in the control that
    // commits (a button, a submit). A goal like "delete my account" must not make every step on
    // the way there ask.
    const navigates = targetElement
      ? /^(a|link|tab|menuitem)$/i.test(targetElement.role)
      : op !== "key";
    const sensitiveLabel =
      targetElement && !navigates ? isSensitiveLabel(targetElement.label) : false;
    const isDestructive =
      !navigates && destructiveAnswer?.type === "noul" ? destructiveAnswer.noul >= 0.5 : false;

    let action: Action = { ...chosen.action };
    if (op === "type" && targetElement) {
      const text = textForType
        ? await textForType({ goal, observation, target: targetElement })
        : null;
      if (shouldStop?.()) {
        return { status: "cancelled", steps, lastObservation: observation, summary: "cancelled" };
      }
      if (text === SKIP_TYPING) {
        remember(
          "the user took care of the sign-in themselves; carry on from the page as it is now",
        );
        observationHashes = [];
        troubles = 0;
        continue;
      }
      if (!text) {
        return giveUp(
          observation,
          `I needed text for "${targetElement.label}" and didn't get it.`,
          {
            targetLabel: targetElement.label,
            decisionId: decision.decisionId,
            opBand,
            targetBand,
          },
        );
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
      return giveUp(observation, "This step needs your approval.", {
        action,
        targetLabel: targetElement?.label,
        decisionId: decision.decisionId,
        outcome: "blocked",
      });
    }

    onPhase?.("acting");
    let result: Awaited<ReturnType<Screen["act"]>>;
    try {
      result = await withDeadline(screen.act(action), limit.act, "The action took too long.");
    } catch (error) {
      result = { ok: false, reason: messageOf(error) };
    }
    if (result.blocked) {
      const ended = await pauseForUser(
        classifyBlocker(observation),
        observation,
        decision.decisionId,
        result.reason,
      );
      if (ended) return ended;
      continue;
    }

    if (!result.ok) {
      if (chosen.element) failed.add(`${observation.url ?? ""}|${chosen.id}`);
      remember(`${describeAction(action, targetElement)} failed`);
      const reason = result.reason ?? "The action failed.";
      if (await recover(observation, reason)) continue;
      return giveUp(observation, reason, {
        action,
        targetLabel: targetElement?.label,
        decisionId: decision.decisionId,
      });
    }

    remember(describeAction(action, targetElement));
    lastExecuted = chosen.element ? `${observation.url ?? ""}|${chosen.id}` : undefined;
    // Only a real step that changes the page counts as getting somewhere, not a guess or a wait.
    if (!forced && action.op !== "wait" && action.op !== "scroll") actionHash = hash;
    // Typing into a search box means searching: submit it in the same step, as
    // Jev rarely infers the Enter on its own.
    if (action.op === "type" && targetElement && isSearchField(targetElement)) {
      const submitted = await withDeadline(
        screen.act({ op: "key", text: "Enter" }),
        limit.act,
        "timeout",
      ).catch(() => ({ ok: false }));
      if (submitted.ok) remember("pressed Enter to search");
    }
    if (settleMs > 0 && ["click", "key", "type", "select"].includes(action.op)) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    }
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

  const lastObservation = await observe().catch(() => undefined);
  return {
    status: "escalated",
    steps,
    lastObservation,
    summary: `Stopped after ${steps} steps without finishing.`,
  };
}

const CAPTCHA_RE =
  /captcha|i'?m not a robot|no soy un robot|verify (that )?you('re| are) (a )?human|are you (a )?human/i;
const CODE_RE =
  /verification code|security code|one[- ]time|\botp\b|2fa|two[- ]factor|authenticator|c[oó]digo de (verificaci[oó]n|seguridad)|enter the (6|six)[- ]digit|enter (the|your) code/i;
const PAYMENT_RE = /card number|cvv|cvc|credit card|debit card|n[uú]mero de tarjeta/i;
const SIGN_IN_RE =
  /pass(word)?\b|contrase[nñ]a|sign[- ]?in|log[- ]?in|iniciar sesi[oó]n|e-?mail|username|usuario/i;

/** What kind of step the page is asking a person for. */
export function classifyBlocker(observation: Observation): BlockerKind {
  const text = observation.elements.map((el) => `${el.role} ${el.label}`).join(" | ");
  if (CAPTCHA_RE.test(text)) return "captcha";
  if (CODE_RE.test(text)) return "code";
  if (PAYMENT_RE.test(text)) return "payment";
  if (looksLikeSignIn(observation)) return "login";
  return "other";
}

/** A password field, or a text field that asks for an account name, is a sign-in form. */
export function looksLikeSignIn(observation: Observation): boolean {
  return observation.elements.some(
    (el) =>
      /^password$/i.test(el.role) ||
      (/^(input|textbox|textarea|searchbox|combobox)$/i.test(el.role) && SIGN_IN_RE.test(el.label)),
  );
}

function blockerReason(kind: BlockerKind): string {
  switch (kind) {
    case "login":
      return "This page needs you to sign in (no saved login for this site).";
    case "code":
      return "This page is asking for a verification code only you have.";
    case "captcha":
      return "This page shows a CAPTCHA that only a person can solve.";
    case "payment":
      return "This step asks for payment details only you can give.";
    default:
      return "This step needs you (take over the screen).";
  }
}

/** The most probable option that is harmless to try: a click, scroll, wait, Escape, or a choice. */
function bestGuess(
  answer: JevAnswerLike | undefined,
  candidates: Candidate[],
): Candidate | undefined {
  const ranked = Object.entries(answer?.probabilities ?? {}).sort((a, b) => b[1] - a[1]);
  for (const [id, probability] of ranked) {
    if (probability < 0.12) break;
    const c = candidates.find((x) => x.id === id);
    if (!c || !c.reversible) continue;
    if (c.element && isSensitiveLabel(c.element.label)) continue;
    return c;
  }
  return undefined;
}

function isSearchField(el: ObservedElement): boolean {
  return (
    /^searchbox$/i.test(el.role) ||
    /\b(search|buscar|busca|rechercher|suchen|cerca)\b/i.test(el.label)
  );
}

/** Buttons that dismiss a cookie/consent notice; rejecting is preferred. */
const REJECT_LABELS =
  /^(reject all( cookies)?|decline all|refuse all|rechazar todo|rechazar todas|rechazar|tout refuser|alle ablehnen|rifiuta tutto)$|^(reject|rechazar) (the use of|el uso de) (cookies|las cookies)/i;
const ACCEPT_LABELS =
  /^(accept all( cookies)?|allow all( cookies)?|i agree|agree|aceptar todo|aceptar todas|aceptar|tout accepter|alle akzeptieren|accetta tutto)$|^(accept|aceptar) (the use of|el uso de) (cookies|las cookies)/i;

function consentButton(observation: Observation): ObservedElement | undefined {
  const text = observation.elements.map((el) => el.label).join(" ");
  if (!/cookie|consent|privacidad|privacy|datenschutz/i.test(text)) return undefined;
  const clickable = observation.elements.filter((el) => /^(button|a|link|input)$/i.test(el.role));
  return (
    clickable.find((el) => REJECT_LABELS.test(el.label.trim())) ??
    clickable.find((el) => ACCEPT_LABELS.test(el.label.trim()))
  );
}

function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** The top two probabilities of a choice answer. */
function clearLead(answer: JevAnswerLike | undefined): { top: number; second: number } {
  const values = Object.values(answer?.probabilities ?? {}).sort((a, b) => b - a);
  return { top: values[0] ?? 0, second: values[1] ?? 0 };
}

/** "click “Search” (38%), type into “Search” (36%)": for the engine to steer with. */
function topChoices(
  answer: JevAnswerLike | undefined,
  candidates: Candidate[],
  count: number,
): string | undefined {
  const entries = Object.entries(answer?.probabilities ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([id, p]) => {
      const c = candidates.find((x) => x.id === id);
      return c
        ? `${c.description.charAt(0).toLowerCase()}${c.description.slice(1)} (${Math.round(p * 100)}%)`
        : undefined;
    })
    .filter(Boolean);
  return entries.length ? entries.join(", ") : undefined;
}

type JevAnswerLike = { type: string; choice?: string; probabilities?: Record<string, number> };

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
