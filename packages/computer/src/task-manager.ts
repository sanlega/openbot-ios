import type {
  Action,
  ComputerProvider,
  DecisionService,
  Observation,
  ObservedElement,
} from "@openbot/contracts";
import type { ComputerActionBroker } from "./broker.js";
import { DefaultComputerActionBroker } from "./broker.js";
import {
  classifyBlocker,
  looksLikeSignIn,
  runFastLoop,
  SKIP_TYPING,
  type BlockedContext,
  type BlockerKind,
  type ComputerPhase,
  type ComputerStepEvent,
} from "./fast-loop.js";

export type ComputerTaskStatus =
  | "running"
  | "needs_input"
  /** Paused on a step only a person can do; continues by itself once it is done. */
  | "needs_user"
  | "completed"
  | "escalated"
  | "takeover"
  | "failed"
  | "cancelled";

/** What the task is waiting for from a person. */
export interface ComputerTaskNeed {
  kind: BlockerKind;
  /** The site the step is on (host), when known. */
  site?: string;
  message: string;
}

export interface ComputerTaskStep {
  step: number;
  op?: Action["op"];
  target?: string;
  outcome: ComputerStepEvent["outcome"];
  reason?: string;
  at: string;
}

export interface ComputerTaskSnapshot {
  taskId: string;
  botId: string;
  goal: string;
  status: ComputerTaskStatus;
  steps: ComputerTaskStep[];
  /** Set while `needs_input`: the field the bot must provide text for. */
  pendingInput?: { field: string };
  /** Set while `needs_user`: the step a person has to do. */
  need?: ComputerTaskNeed;
  instructions: string[];
  summary?: string;
  url?: string;
  title?: string;
  /** What the task is doing now (while running). */
  phase?: ComputerPhase;
  /** Labels of what's on screen at the last look, so the engine can check the result. */
  visible?: string[];
}

export interface StartComputerTask {
  taskId: string;
  botId: string;
  chainId: string;
  goal: string;
  startUrl?: string;
  maxSteps?: number;
  /** Text the engine already knows, keyed by field label (matched case-insensitively). */
  inputs?: Record<string, string>;
}

/**
 * Where the host looks up secrets at the moment of typing, so the engine never holds a value:
 * `secret:` references it was given, and the saved login for the page the task is on.
 */
export interface TaskSecrets {
  resolveRef(ref: string): Promise<string | undefined>;
  loginFor(url: string | undefined): Promise<{ username?: string; password?: string } | undefined>;
  /** "password" or "username" when the field asks for one of them. */
  fieldKind(label: string, role?: string): "password" | "username" | undefined;
}

export interface ComputerTaskManagerOptions {
  /** Resolves `secret:` inputs and typed logins from the vault. */
  secrets?: TaskSecrets;
  decisionService: DecisionService;
  provider: ComputerProvider;
  broker?: ComputerActionBroker;
  now?: () => Date;
  /** Per-phase limits for the loop (see FastLoopOptions.timeouts). */
  timeouts?: Partial<Record<"observe" | "decide" | "act", number>>;
  /** How long a task waits for the engine to supply text before escalating. */
  inputTimeoutMs?: number;
  /** How long a task waits for a person (sign-in, code) before ending as `takeover`. */
  blockedTimeoutMs?: number;
  /** How often a paused task looks at the page to notice the person finished. */
  blockedPollMs?: number;
  onUpdate?: (snapshot: ComputerTaskSnapshot, event?: ComputerStepEvent) => void;
}

interface TaskRuntime {
  snapshot: ComputerTaskSnapshot;
  req: StartComputerTask;
  /** Ends the wait of a task paused for a person: "resume" carries on, "stop" ends it. */
  resumeBlocked?: (verdict: "resume" | "stop") => void;
  inputs: Record<string, string>;
  /** Secret values the host typed in this task; masked in everything Jev or the UI sees. */
  typedSecrets: Set<string>;
  cancelled: boolean;
  pendingText?: (text: string | null) => void;
  settled: Promise<void>;
  waiters: Set<() => void>;
}

const DEFAULT_INPUT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_BLOCKED_TIMEOUT_MS = 60 * 60_000;
const DEFAULT_BLOCKED_POLL_MS = 3_000;
/** A finished task that can pick up again from the same page when steered. */
const RESUMABLE: ReadonlySet<ComputerTaskStatus> = new Set(["escalated", "takeover", "failed"]);
const TERMINAL: ReadonlySet<ComputerTaskStatus> = new Set([
  "completed",
  "escalated",
  "takeover",
  "failed",
  "cancelled",
]);

/**
 * Runs computer tasks in the background so the engine that started one can
 * poll, steer, supply text, or cancel it. Jev picks each step; the engine
 * authors free text; the broker and provider still gate and execute every action.
 */
export class ComputerTaskManager {
  private readonly tasks = new Map<string, TaskRuntime>();
  private readonly broker: ComputerActionBroker;
  private readonly now: () => Date;

  constructor(private readonly opts: ComputerTaskManagerOptions) {
    this.broker = opts.broker ?? new DefaultComputerActionBroker();
    this.now = opts.now ?? (() => new Date());
  }

  start(req: StartComputerTask): ComputerTaskSnapshot {
    // One screen per bot: a new task replaces the bot's unfinished one instead of both fighting
    // over the same browser.
    for (const other of this.tasks.values()) {
      if (other.snapshot.botId === req.botId && !TERMINAL.has(other.snapshot.status)) {
        this.cancel(other.snapshot.taskId, `Replaced by a newer task (${req.taskId}).`);
      }
    }
    const runtime: TaskRuntime = {
      snapshot: {
        taskId: req.taskId,
        botId: req.botId,
        goal: req.goal,
        status: "running",
        steps: [],
        instructions: [],
      },
      req,
      inputs: { ...(req.inputs ?? {}) },
      typedSecrets: new Set(),
      cancelled: false,
      settled: Promise.resolve(),
      waiters: new Set(),
    };
    this.tasks.set(req.taskId, runtime);
    runtime.settled = this.run(runtime, req).catch((err: unknown) => {
      this.finish(runtime, "failed", err instanceof Error ? err.message : String(err));
    });
    this.emit(runtime);
    return this.copy(runtime.snapshot);
  }

  get(taskId: string): ComputerTaskSnapshot | undefined {
    const runtime = this.tasks.get(taskId);
    return runtime ? this.copy(runtime.snapshot) : undefined;
  }

  /** Resolves when the task leaves `running` (finishes or needs input), or after `ms`. */
  async wait(taskId: string, ms: number): Promise<ComputerTaskSnapshot | undefined> {
    const runtime = this.tasks.get(taskId);
    if (!runtime) return undefined;
    if (runtime.snapshot.status !== "running" || ms <= 0) return this.copy(runtime.snapshot);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        runtime.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      runtime.waiters.add(done);
    });
    return this.copy(runtime.snapshot);
  }

  /** Adds guidance for later steps and/or answers a pending text request. */
  steer(
    taskId: string,
    input: { instruction?: string; text?: string },
  ): ComputerTaskSnapshot | undefined {
    const runtime = this.tasks.get(taskId);
    if (!runtime) return undefined;
    if (input.instruction?.trim()) runtime.snapshot.instructions.push(input.instruction.trim());
    if (runtime.resumeBlocked) {
      // Any guidance to a task waiting for a person means "carry on".
      const resume = runtime.resumeBlocked;
      runtime.snapshot.status = "running";
      resume("resume");
    } else if (RESUMABLE.has(runtime.snapshot.status) && !runtime.cancelled) {
      // A task that stopped short picks up again from the page it is on, keeping its history.
      this.restart(runtime);
    }
    if (input.text !== undefined && runtime.pendingText) {
      const resolve = runtime.pendingText;
      runtime.pendingText = undefined;
      runtime.snapshot.pendingInput = undefined;
      runtime.snapshot.status = "running";
      resolve(input.text);
    }
    this.emit(runtime);
    return this.copy(runtime.snapshot);
  }

  cancel(taskId: string, reason = "Cancelled."): ComputerTaskSnapshot | undefined {
    const runtime = this.tasks.get(taskId);
    if (!runtime) return undefined;
    if (!TERMINAL.has(runtime.snapshot.status)) {
      runtime.cancelled = true;
      runtime.pendingText?.(null);
      runtime.pendingText = undefined;
      runtime.resumeBlocked?.("stop");
      this.finish(runtime, "cancelled", reason);
    }
    return this.copy(runtime.snapshot);
  }

  private restart(runtime: TaskRuntime): void {
    runtime.snapshot.status = "running";
    runtime.snapshot.summary = undefined;
    const req = { ...runtime.req, startUrl: undefined };
    runtime.settled = this.run(runtime, req).catch((err: unknown) => {
      this.finish(runtime, "failed", err instanceof Error ? err.message : String(err));
    });
    this.emit(runtime);
  }

  private async run(runtime: TaskRuntime, req: StartComputerTask): Promise<void> {
    const { provider, decisionService } = this.opts;
    await provider.ensureStarted();
    const screen = await provider.screen(req.botId);
    const result = await runFastLoop({
      screen,
      decisionService,
      goal: req.goal,
      botId: req.botId,
      chainId: req.chainId,
      providerId: provider.id,
      maxSteps: req.maxSteps,
      startUrl: req.startUrl,
      broker: this.broker,
      instructions: () => runtime.snapshot.instructions,
      shouldStop: () => runtime.cancelled,
      timeouts: this.opts.timeouts,
      onPhase: (phase) => {
        runtime.snapshot.phase = phase;
        this.emit(runtime);
      },
      textForType: (ctx) =>
        this.textFor(runtime, ctx.target, ctx.observation.url, screen, ctx.observation),
      hasSavedLogin: this.opts.secrets
        ? async (url) => {
            const login = await this.opts.secrets!.loginFor(url);
            return Boolean(login?.username || login?.password);
          }
        : undefined,
      onBlocked: (ctx) => this.waitForPerson(runtime, screen, ctx),
      redactObservation: (observation) => maskSecrets(observation, runtime.typedSecrets),
      onStep: (event) => {
        runtime.snapshot.steps.push({
          step: event.step,
          op: event.action?.op,
          target: event.targetLabel,
          outcome: event.outcome,
          reason: event.reason,
          at: this.now().toISOString(),
        });
        runtime.snapshot.url = event.observation.url;
        runtime.snapshot.title = event.observation.title;
        runtime.snapshot.visible = event.observation.elements
          .map((el) => el.label.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 25);
        this.emit(runtime, event);
      },
    });
    if (runtime.cancelled) return;
    this.finish(
      runtime,
      result.status === "completed" ? "completed" : result.status,
      result.summary,
    );
  }

  /**
   * Pauses on a step only a person can do. The task carries on when the engine steers it (after
   * saving a login, say), or by itself when the page shows the person finished it (they signed in
   * inside the virtual machine). Ends as `takeover` after the timeout.
   */
  private waitForPerson(
    runtime: TaskRuntime,
    screen: { observe(): Promise<Observation> },
    ctx: BlockedContext,
  ): Promise<"resume" | "stop"> {
    const site = hostOf(ctx.observation.url);
    runtime.snapshot.status = "needs_user";
    runtime.snapshot.need = { kind: ctx.kind, ...(site ? { site } : {}), message: ctx.reason };
    this.emit(runtime);
    this.wake(runtime);
    const startUrl = ctx.observation.url;
    return new Promise<"resume" | "stop">((resolve) => {
      const settle = (verdict: "resume" | "stop") => {
        clearTimeout(timer);
        clearInterval(poll);
        runtime.resumeBlocked = undefined;
        runtime.snapshot.need = undefined;
        if (verdict === "resume") runtime.snapshot.status = "running";
        resolve(verdict);
      };
      const timer = setTimeout(
        () => settle("stop"),
        this.opts.blockedTimeoutMs ?? DEFAULT_BLOCKED_TIMEOUT_MS,
      );
      runtime.resumeBlocked = settle;
      let looking = false;
      const poll = setInterval(() => {
        if (looking) return;
        looking = true;
        screen
          .observe()
          .then((observation) => {
            if (runtime.resumeBlocked !== settle) return;
            const now = classifyBlocker(observation);
            const moved = observation.url !== startUrl;
            const done =
              ctx.kind === "login"
                ? !looksLikeSignIn(observation) || (moved && now !== "login")
                : ctx.kind === "other"
                  ? moved
                  : now !== ctx.kind;
            if (done) {
              settle("resume");
              this.emit(runtime);
            }
          })
          .catch(() => undefined)
          .finally(() => {
            looking = false;
          });
      }, this.opts.blockedPollMs ?? DEFAULT_BLOCKED_POLL_MS);
    });
  }

  /** Text for a field: from the engine's `inputs`, else ask the engine and wait. */
  private textFor(
    runtime: TaskRuntime,
    target?: ObservedElement,
    pageUrl?: string,
    screen?: { observe(): Promise<Observation> },
    observation?: Observation,
  ): Promise<string | null> {
    const label = target?.label ?? "the field";
    const known = matchInput(runtime.inputs, label);
    if (known !== undefined) {
      if (!known.startsWith("secret:") || !this.opts.secrets) return Promise.resolve(known);
      return this.opts.secrets.resolveRef(known).then((value) => {
        if (value === undefined) return this.askEngine(runtime, label);
        runtime.typedSecrets.add(value);
        return value;
      });
    }
    const kind = this.opts.secrets?.fieldKind(label, target?.role);
    if (kind && this.opts.secrets) {
      const secrets = this.opts.secrets;
      // The page being typed into right now (the task's last step may be on another page).
      return secrets.loginFor(pageUrl ?? runtime.snapshot.url).then((login) => {
        const value = login?.[kind];
        if (!value) {
          return screen && observation
            ? this.credentialsFromPerson(runtime, screen, observation, kind, label)
            : this.askEngine(runtime, label);
        }
        runtime.typedSecrets.add(value);
        return value;
      });
    }
    return this.askEngine(runtime, label);
  }

  /**
   * A sign-in field with no saved login: pause for a person instead of asking the engine for text.
   * Either the user signs in inside the virtual machine (the field needs no typing any more), or
   * the engine gets the credentials from them, saves the login and steers the task on.
   */
  private async credentialsFromPerson(
    runtime: TaskRuntime,
    screen: { observe(): Promise<Observation> },
    observation: Observation,
    kind: "username" | "password",
    label: string,
  ): Promise<string | null> {
    const verdict = await this.waitForPerson(runtime, screen, {
      kind: "login",
      observation,
      reason: "This page needs you to sign in (no saved login for this site).",
    });
    if (verdict === "stop" || runtime.cancelled) return null;
    const now = await screen.observe().catch(() => undefined);
    if (now && !looksLikeSignIn(now)) return SKIP_TYPING;
    const login = await this.opts.secrets?.loginFor(now?.url ?? observation.url);
    const value = login?.[kind];
    if (value) {
      runtime.typedSecrets.add(value);
      return value;
    }
    // The engine may have steered the text in meanwhile (`inputs`, or a `secret:` reference).
    if (matchInput(runtime.inputs, label) !== undefined) {
      return this.textFor(runtime, { index: -1, role: "input", label }, now?.url);
    }
    return this.askEngine(runtime, label);
  }

  /** No known text: ask the engine and wait (or time out). */
  private askEngine(runtime: TaskRuntime, label: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        if (runtime.pendingText) {
          runtime.pendingText = undefined;
          runtime.snapshot.pendingInput = undefined;
          resolve(null);
        }
      }, this.opts.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS);
      runtime.pendingText = (text) => {
        clearTimeout(timer);
        if (text !== null) runtime.inputs[label] = text;
        resolve(text);
      };
      runtime.snapshot.status = "needs_input";
      runtime.snapshot.pendingInput = { field: label };
      this.emit(runtime);
      this.wake(runtime);
    });
  }

  private finish(runtime: TaskRuntime, status: ComputerTaskStatus, summary?: string): void {
    if (TERMINAL.has(runtime.snapshot.status)) return;
    runtime.snapshot.status = status;
    runtime.snapshot.summary = summary;
    runtime.snapshot.phase = undefined;
    runtime.snapshot.pendingInput = undefined;
    runtime.snapshot.need = undefined;
    this.emit(runtime);
    this.wake(runtime);
  }

  private wake(runtime: TaskRuntime): void {
    for (const waiter of [...runtime.waiters]) waiter();
  }

  private emit(runtime: TaskRuntime, event?: ComputerStepEvent): void {
    this.opts.onUpdate?.(this.copy(runtime.snapshot), event);
  }

  private copy(snapshot: ComputerTaskSnapshot): ComputerTaskSnapshot {
    return {
      ...snapshot,
      steps: [...snapshot.steps],
      instructions: [...snapshot.instructions],
      pendingInput: snapshot.pendingInput ? { ...snapshot.pendingInput } : undefined,
      need: snapshot.need ? { ...snapshot.need } : undefined,
    };
  }
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** Shortest key that may match by containment; shorter ones must match the label exactly. */
const MIN_PARTIAL_KEY = 3;

function matchInput(inputs: Record<string, string>, label: string): string | undefined {
  const wanted = label.trim().toLowerCase();
  if (!wanted) return undefined;
  for (const [key, value] of Object.entries(inputs)) {
    const k = key.trim().toLowerCase();
    // An empty key must never match every field.
    if (!k) continue;
    if (k === wanted) return value;
    if (k.length >= MIN_PARTIAL_KEY && (wanted.includes(k) || k.includes(wanted))) return value;
  }
  return undefined;
}

const MASK = "••••••";

/** Replaces any field value that holds a secret the host typed, so it never reaches Jev or events. */
function maskSecrets(observation: Observation, secrets: Set<string>): Observation {
  if (secrets.size === 0) return observation;
  return {
    ...observation,
    elements: observation.elements.map((el) =>
      el.value && [...secrets].some((secret) => el.value!.includes(secret))
        ? { ...el, value: MASK }
        : el,
    ),
  };
}
