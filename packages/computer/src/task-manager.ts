import type {
  Action,
  ComputerProvider,
  DecisionService,
  ObservedElement,
} from "@openbot/contracts";
import type { ComputerActionBroker } from "./broker.js";
import { DefaultComputerActionBroker } from "./broker.js";
import { runFastLoop, type ComputerPhase, type ComputerStepEvent } from "./fast-loop.js";

export type ComputerTaskStatus =
  "running" | "needs_input" | "completed" | "escalated" | "takeover" | "failed" | "cancelled";

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

export interface ComputerTaskManagerOptions {
  decisionService: DecisionService;
  provider: ComputerProvider;
  broker?: ComputerActionBroker;
  now?: () => Date;
  /** Per-phase limits for the loop (see FastLoopOptions.timeouts). */
  timeouts?: Partial<Record<"observe" | "decide" | "act", number>>;
  /** How long a task waits for the engine to supply text before escalating. */
  inputTimeoutMs?: number;
  onUpdate?: (snapshot: ComputerTaskSnapshot, event?: ComputerStepEvent) => void;
}

interface TaskRuntime {
  snapshot: ComputerTaskSnapshot;
  inputs: Record<string, string>;
  cancelled: boolean;
  pendingText?: (text: string | null) => void;
  settled: Promise<void>;
  waiters: Set<() => void>;
}

const DEFAULT_INPUT_TIMEOUT_MS = 10 * 60_000;
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
    const runtime: TaskRuntime = {
      snapshot: {
        taskId: req.taskId,
        botId: req.botId,
        goal: req.goal,
        status: "running",
        steps: [],
        instructions: [],
      },
      inputs: { ...(req.inputs ?? {}) },
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

  cancel(taskId: string): ComputerTaskSnapshot | undefined {
    const runtime = this.tasks.get(taskId);
    if (!runtime) return undefined;
    if (!TERMINAL.has(runtime.snapshot.status)) {
      runtime.cancelled = true;
      runtime.pendingText?.(null);
      runtime.pendingText = undefined;
      this.finish(runtime, "cancelled", "Cancelled.");
    }
    return this.copy(runtime.snapshot);
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
      textForType: (ctx) => this.textFor(runtime, ctx.target),
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

  /** Text for a field: from the engine's `inputs`, else ask the engine and wait. */
  private textFor(runtime: TaskRuntime, target?: ObservedElement): Promise<string | null> {
    const label = target?.label ?? "the field";
    const known = matchInput(runtime.inputs, label);
    if (known !== undefined) return Promise.resolve(known);
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
    };
  }
}

function matchInput(inputs: Record<string, string>, label: string): string | undefined {
  const wanted = label.trim().toLowerCase();
  for (const [key, value] of Object.entries(inputs)) {
    const k = key.trim().toLowerCase();
    if (k === wanted || wanted.includes(k) || k.includes(wanted)) return value;
  }
  return undefined;
}
