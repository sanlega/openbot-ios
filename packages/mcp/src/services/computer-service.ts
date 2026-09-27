import { newId, type Approval } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import {
  ComputerTaskManager,
  DefaultComputerActionBroker,
  type BrokerDecision,
  type ComputerActionBroker,
  type ComputerTaskSnapshot,
} from "@openbot/computer";
import type { Runtime } from "@openbot/runtime";
import type {
  ComputerStatusInput,
  ComputerSteerInput,
  ComputerTaskInput,
  ComputerTaskView,
  SessionContext,
  ToolResult,
} from "../types.js";
import { allowed, refused } from "../types.js";
import type { McpComputerService } from "./interfaces.js";

const DEFAULT_WAIT_S = 20;

/**
 * Computer tools for every engine: start a task that runs in the background
 * (Jev picks steps, OpenBot checks and acts), then follow, steer, or cancel it.
 * Risky steps go through the runtime permission broker, which shows the user an
 * approval card and waits for the answer.
 */
export class McpComputerServiceAdapter implements McpComputerService {
  private manager: ComputerTaskManager | undefined;
  private readonly owners = new Map<string, string>();

  constructor(
    private readonly ctx: CoreContext,
    private readonly runtime?: Runtime,
  ) {}

  async computerTask(
    session: SessionContext,
    input: ComputerTaskInput,
  ): Promise<ToolResult<ComputerTaskView>> {
    if (session.mode === "dry_run") {
      return allowed({
        taskId: newId("computerTask"),
        status: "simulated",
        steps: 0,
        recentSteps: [],
      });
    }
    if (!this.ctx.computerProvider) return refused("no computer provider wired");
    if (!this.ctx.decisionService) return refused("no decision service wired");

    const taskId = newId("computerTask");
    const providerId = this.ctx.computerProvider.id as "docker" | "local" | "fake";
    this.ctx.repos.computerTasks.create({
      id: taskId,
      botId: session.botId,
      chainId: session.chainId,
      goal: input.goal,
      provider: providerId,
      status: "running",
      steps: 0,
      usd: 0,
      createdAt: this.ctx.clock.now().toISOString(),
    });
    this.owners.set(taskId, session.botId);
    this.getManager().start({
      taskId,
      botId: session.botId,
      chainId: session.chainId,
      goal: input.goal,
      startUrl: input.startUrl,
      maxSteps: input.maxSteps,
      inputs: input.inputs,
    });
    const snapshot = await this.getManager().wait(taskId, waitMs(input.waitSeconds));
    return allowed(view(snapshot!));
  }

  async computerStatus(
    session: SessionContext,
    input: ComputerStatusInput,
  ): Promise<ToolResult<ComputerTaskView>> {
    const denied = this.checkOwner(session, input.taskId);
    if (denied) return denied;
    const snapshot = await this.getManager().wait(input.taskId, waitMs(input.waitSeconds, 0));
    return snapshot ? allowed(view(snapshot)) : refused(`no computer task ${input.taskId}`);
  }

  async computerSteer(
    session: SessionContext,
    input: ComputerSteerInput,
  ): Promise<ToolResult<ComputerTaskView>> {
    const denied = this.checkOwner(session, input.taskId);
    if (denied) return denied;
    const steered = this.getManager().steer(input.taskId, {
      instruction: input.instruction,
      text: input.text,
    });
    if (!steered) return refused(`no computer task ${input.taskId}`);
    const snapshot = await this.getManager().wait(input.taskId, waitMs(input.waitSeconds));
    return allowed(view(snapshot ?? steered));
  }

  async computerCancel(
    session: SessionContext,
    input: { taskId: string },
  ): Promise<ToolResult<ComputerTaskView>> {
    const denied = this.checkOwner(session, input.taskId);
    if (denied) return denied;
    const snapshot = this.getManager().cancel(input.taskId);
    return snapshot ? allowed(view(snapshot)) : refused(`no computer task ${input.taskId}`);
  }

  /** The same tasks, for the Client API (UI timeline, steering, cancel). */
  controller(): {
    get(taskId: string): ComputerTaskSnapshot | undefined;
    steer(
      taskId: string,
      input: { instruction?: string; text?: string },
    ): ComputerTaskSnapshot | undefined;
    cancel(taskId: string): ComputerTaskSnapshot | undefined;
  } {
    return {
      get: (taskId) => this.manager?.get(taskId),
      steer: (taskId, input) => this.manager?.steer(taskId, input),
      cancel: (taskId) => this.manager?.cancel(taskId),
    };
  }

  async computerScreenshot(
    session: SessionContext,
  ): Promise<ToolResult<{ screenshotPath: string }>> {
    if (!this.ctx.computerProvider) return refused("no computer provider wired");
    await this.ctx.computerProvider.ensureStarted();
    const screen = await this.ctx.computerProvider.screen(session.botId);
    const observation = await screen.observe();
    return allowed({
      screenshotPath: observation.screenshotPath ?? `/screens/${session.botId}/latest.png`,
    });
  }

  /** A bot can only follow or steer its own tasks. */
  private checkOwner(session: SessionContext, taskId: string): ToolResult<never> | undefined {
    if (!this.manager) return refused(`no computer task ${taskId}`);
    const owner = this.owners.get(taskId);
    if (!owner) return refused(`no computer task ${taskId}`);
    if (owner !== session.botId) return refused("that computer task belongs to another bot");
    return undefined;
  }

  private getManager(): ComputerTaskManager {
    if (!this.manager) {
      if (!this.ctx.decisionService || !this.ctx.computerProvider) {
        throw new Error("computer tasks require decisionService and computerProvider");
      }
      this.manager = new ComputerTaskManager({
        decisionService: this.ctx.decisionService,
        provider: this.ctx.computerProvider,
        broker: new ApprovalComputerBroker(this.runtime),
        now: () => this.ctx.clock.now(),
        onUpdate: (snapshot, event) => void this.record(snapshot, event !== undefined),
      });
    }
    return this.manager;
  }

  /** Persists progress and streams it to the UI as computer.* events. */
  private async record(snapshot: ComputerTaskSnapshot, isStep: boolean): Promise<void> {
    const status =
      snapshot.status === "completed"
        ? "completed"
        : snapshot.status === "running" || snapshot.status === "needs_input"
          ? "running"
          : snapshot.status === "failed" || snapshot.status === "cancelled"
            ? "failed"
            : "escalated";
    this.ctx.repos.computerTasks.update(snapshot.taskId, {
      status,
      steps: snapshot.steps.length,
      usd: snapshot.steps.length * 0.000_8,
    });
    const last = snapshot.steps[snapshot.steps.length - 1];
    const type =
      snapshot.status === "completed" ||
      snapshot.status === "cancelled" ||
      snapshot.status === "failed"
        ? "computer.task_completed"
        : snapshot.status === "escalated"
          ? "computer.escalated"
          : snapshot.status === "takeover"
            ? "computer.takeover_requested"
            : isStep
              ? "computer.step"
              : snapshot.steps.length === 0
                ? "computer.task_started"
                : "computer.step";
    await this.ctx.eventBus.publish({
      type,
      botId: snapshot.botId,
      payload: {
        taskId: snapshot.taskId,
        status: snapshot.status,
        goal: snapshot.goal,
        step: last,
        steps: snapshot.steps.length,
        needsText: snapshot.pendingInput?.field,
        summary: snapshot.summary,
      },
    });
  }
}

/**
 * The computer loop's broker: the default rules decide allow/ask; "ask" becomes
 * a real approval card through the runtime broker, and the step waits for the
 * user's answer instead of ending the task.
 */
class ApprovalComputerBroker implements ComputerActionBroker {
  private readonly rules = new DefaultComputerActionBroker();

  constructor(private readonly runtime?: Runtime) {}

  async checkAction(
    input: Parameters<ComputerActionBroker["checkAction"]>[0],
  ): Promise<BrokerDecision> {
    const decision = await this.rules.checkAction(input);
    if (decision !== "ask" || !this.runtime) return decision;
    const target =
      input.action.target !== undefined
        ? input.observation.elements.find((el) => el.index === input.action.target)?.label
        : undefined;
    const verb =
      input.action.op === "type" ? "Type into" : input.action.op === "key" ? "Press" : "Click";
    const what =
      input.action.op === "key" ? (input.action.text ?? "a key") : (target ?? "an element");
    const request = {
      botId: input.botId,
      chainId: input.chainId,
      kind: (input.providerId === "local" ? "local_computer" : "computer_action") as
        "local_computer" | "computer_action",
      action: input.action.op,
      target,
      sideEffect: input.isDestructive,
      summary: `${verb} "${what}"${input.observation.title ? ` on ${input.observation.title}` : ""}`,
      detail: JSON.stringify({
        op: input.action.op,
        target,
        page: input.observation.url,
        ...(input.action.op === "type" ? { text: input.action.text } : {}),
      }),
    };
    const evaluated = await this.runtime.broker.evaluate(request, {
      mode: "live",
      preset: "workspace_write",
    });
    if (evaluated.outcome === "deny" || evaluated.outcome === "simulate") return "deny";
    // Our rules said the user must confirm (destructive, sensitive, or this
    // computer): a card is required even if the risk gate would have allowed it.
    const approvalId =
      evaluated.outcome === "ask" && evaluated.approvalId
        ? evaluated.approvalId
        : this.runtime.broker.requireApproval(request, "computer step needs your OK").approvalId;
    if (!approvalId) return "deny";
    const resolution: Approval["resolution"] =
      await this.runtime.broker.waitForApproval(approvalId);
    return resolution === "allow" ? "allow" : "deny";
  }
}

function waitMs(seconds: number | undefined, fallback = DEFAULT_WAIT_S): number {
  return Math.max(0, Math.min(60, seconds ?? fallback)) * 1000;
}

function view(snapshot: ComputerTaskSnapshot): ComputerTaskView {
  return {
    taskId: snapshot.taskId,
    status: snapshot.status,
    steps: snapshot.steps.length,
    summary: snapshot.summary,
    needsText: snapshot.pendingInput?.field,
    recentSteps: snapshot.steps
      .slice(-5)
      .map((s) =>
        [s.op ?? s.outcome, s.target ? `"${s.target}"` : "", s.reason ? `— ${s.reason}` : ""]
          .filter(Boolean)
          .join(" "),
      ),
    page: snapshot.url || snapshot.title ? { url: snapshot.url, title: snapshot.title } : undefined,
  };
}
