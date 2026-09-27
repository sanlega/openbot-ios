import { newId, type Bot, type McpServerSpec } from "@openbot/contracts";
import type {
  ComputerTaskInput,
  ComputerTaskView,
  CreateBotInput,
  CreateRoutineInput,
  MessageUserInput,
  ReportDoneInput,
  RequestApprovalInput,
  RunRoutineInput,
  SendMessageInput,
  SessionContext,
  ToolResult,
  UpdateRoutineInput,
} from "../types.js";
import { allowed, refused } from "../types.js";
import type {
  McpComputerService,
  McpConnectorComposer,
  McpCosService,
  McpRoutineService,
  McpRuntimeService,
  McpToolServices,
} from "./interfaces.js";

export interface FakeCosOptions {
  allowCreate?: boolean;
  createSuggestion?: string;
  messageDelivery?: "delivered" | "held" | "merged";
}

/**
 * In-memory fakes for WS2/WS8/WS9/WS12 dependencies. Integration tests and
 * early engine sessions use these until the real workstreams wire in.
 */
export function createFakeMcpServices(options: { cos?: FakeCosOptions } = {}): McpToolServices & {
  runtime: FakeRuntimeService;
  cos: FakeCosService;
  computer: FakeComputerService;
  routines: FakeRoutineService;
} {
  const runtime = new FakeRuntimeService();
  const cos = new FakeCosService(options.cos);
  const computer = new FakeComputerService();
  const routines = new FakeRoutineService();
  return { runtime, cos, computer, routines, connectors: new FakeConnectorComposer() };
}

export class FakeRuntimeService implements McpRuntimeService {
  readonly sendMessageCalls: Array<{ session: SessionContext; input: SendMessageInput }> = [];
  readonly approvalCalls: Array<{ session: SessionContext; input: RequestApprovalInput }> = [];
  readonly reportDoneCalls: Array<{ session: SessionContext; input: ReportDoneInput }> = [];

  async sendMessage(
    session: SessionContext,
    input: SendMessageInput,
  ): Promise<ToolResult<{ queued: boolean }>> {
    this.sendMessageCalls.push({ session, input });
    if (session.mode === "dry_run") {
      return allowed({ queued: false, simulated: true } as { queued: boolean });
    }
    return allowed({ queued: true });
  }

  async requestApproval(
    session: SessionContext,
    input: RequestApprovalInput,
  ): Promise<ToolResult<{ approvalId: string }>> {
    this.approvalCalls.push({ session, input });
    return allowed({ approvalId: newId("approval") });
  }

  async reportDone(
    session: SessionContext,
    input: ReportDoneInput,
  ): Promise<ToolResult<{ logged: boolean }>> {
    this.reportDoneCalls.push({ session, input });
    return allowed({ logged: true });
  }

  async permissionPrompt(
    _session: SessionContext,
    _input: { tool_name: string; input: unknown },
  ): Promise<ToolResult<{ behavior: "allow" | "deny" }>> {
    return allowed({ behavior: "allow" as const });
  }
}

export class FakeCosService implements McpCosService {
  readonly createBotCalls: Array<{ session: SessionContext; input: CreateBotInput }> = [];
  readonly messageUserCalls: Array<{ session: SessionContext; input: MessageUserInput }> = [];

  constructor(private readonly options: FakeCosOptions = {}) {}

  async createBot(
    session: SessionContext,
    input: CreateBotInput,
  ): Promise<ToolResult<{ bot: Bot }>> {
    this.createBotCalls.push({ session, input });
    if (session.mode === "dry_run") {
      return allowed({ bot: makeFakeBot(input.name), simulated: true });
    }
    if (this.options.allowCreate === false) {
      return refused("spawn cap reached", this.options.createSuggestion ?? "cos_itself");
    }
    return allowed({ bot: makeFakeBot(input.name) });
  }

  async messageUser(
    session: SessionContext,
    input: MessageUserInput,
  ): Promise<
    ToolResult<{ delivery: "delivered" | "held" | "merged"; pushed?: boolean; messageId?: string }>
  > {
    this.messageUserCalls.push({ session, input });
    const delivery = this.options.messageDelivery ?? "delivered";
    return allowed({
      delivery,
      pushed: delivery === "delivered" && input.kind === "blocker",
      messageId: newId("message"),
    });
  }
}

export class FakeComputerService implements McpComputerService {
  readonly taskCalls: Array<{ session: SessionContext; input: ComputerTaskInput }> = [];

  async computerTask(
    session: SessionContext,
    input: ComputerTaskInput,
  ): Promise<ToolResult<ComputerTaskView>> {
    this.taskCalls.push({ session, input });
    const taskId = newId("computerTask");
    if (session.mode === "dry_run") {
      return allowed({ taskId, status: "simulated", steps: 0, recentSteps: [] });
    }
    return allowed({ taskId, status: "completed", steps: 3, recentSteps: [] });
  }

  async computerStatus(
    _session: SessionContext,
    input: { taskId: string },
  ): Promise<ToolResult<ComputerTaskView>> {
    return allowed({ taskId: input.taskId, status: "completed", steps: 3, recentSteps: [] });
  }

  async computerSteer(
    _session: SessionContext,
    input: { taskId: string },
  ): Promise<ToolResult<ComputerTaskView>> {
    return allowed({ taskId: input.taskId, status: "running", steps: 1, recentSteps: [] });
  }

  async computerCancel(
    _session: SessionContext,
    input: { taskId: string },
  ): Promise<ToolResult<ComputerTaskView>> {
    return allowed({ taskId: input.taskId, status: "cancelled", steps: 1, recentSteps: [] });
  }

  async computerScreenshot(
    session: SessionContext,
  ): Promise<ToolResult<{ screenshotPath: string }>> {
    return allowed({ screenshotPath: `/screens/${session.botId}/latest.png` });
  }
}

export class FakeRoutineService implements McpRoutineService {
  readonly routines: Array<{ id: string; botId: string; name: string }> = [];

  async createRoutine(
    session: SessionContext,
    input: CreateRoutineInput,
  ): Promise<ToolResult<{ routineId: string; dryRunQueued: boolean }>> {
    const botId = input.botId && session.isChiefOfStaff ? input.botId : session.botId;
    const id = newId("routine");
    this.routines.push({ id, botId, name: input.name });
    return allowed({ routineId: id, dryRunQueued: true });
  }

  async listRoutines(session: SessionContext): Promise<ToolResult<{ routines: unknown[] }>> {
    const list = session.isChiefOfStaff
      ? this.routines
      : this.routines.filter((r) => r.botId === session.botId);
    return allowed({ routines: list });
  }

  async updateRoutine(
    _session: SessionContext,
    input: UpdateRoutineInput,
  ): Promise<ToolResult<{ routineId: string }>> {
    return allowed({ routineId: input.id });
  }

  async runRoutine(
    _session: SessionContext,
    input: RunRoutineInput,
  ): Promise<ToolResult<{ runId: string; dryRun: boolean }>> {
    return allowed({ runId: newId("routineRun"), dryRun: input.dryRun ?? false });
  }
}

export class FakeConnectorComposer implements McpConnectorComposer {
  async connectorServersForTurn(_botId: string, connectionIds: string[]): Promise<McpServerSpec[]> {
    return connectionIds.map((id) => ({
      name: `connector_${id}`,
      command: "node",
      args: ["-e", "console.log('fake connector')"],
    }));
  }
}

function makeFakeBot(name: string): Bot {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  return {
    id: newId("bot"),
    slug,
    name,
    description: name,
    pinned: false,
    hidden: false,
    isChiefOfStaff: false,
    createdBy: "bot_cos",
    routing: { mode: "auto" },
    permissionPreset: "workspace_write",
    computer: "docker",
    connectors: [],
    limits: {},
  };
}
