import type { ComputerTasksControl } from "@openbot/core";
import type { Bot, McpServerSpec } from "@openbot/contracts";
import type {
  ComputerStatusInput,
  ComputerSteerInput,
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

export interface McpRuntimeService {
  sendMessage(
    session: SessionContext,
    input: SendMessageInput,
  ): Promise<ToolResult<{ queued: boolean }>>;
  requestApproval(
    session: SessionContext,
    input: RequestApprovalInput,
  ): Promise<ToolResult<{ approvalId: string }>>;
  reportDone(
    session: SessionContext,
    input: ReportDoneInput,
  ): Promise<ToolResult<{ logged: boolean }>>;
  permissionPrompt(
    session: SessionContext,
    input: { tool_name: string; input: unknown },
  ): Promise<ToolResult<{ behavior: "allow" | "deny" }>>;
}

export interface McpCosService {
  createBot(session: SessionContext, input: CreateBotInput): Promise<ToolResult<{ bot: Bot }>>;
  messageUser(
    session: SessionContext,
    input: MessageUserInput,
  ): Promise<
    ToolResult<{ delivery: "delivered" | "held" | "merged"; pushed?: boolean; messageId?: string }>
  >;
}

export interface McpComputerService {
  computerTask(
    session: SessionContext,
    input: ComputerTaskInput,
  ): Promise<ToolResult<ComputerTaskView>>;
  computerStatus(
    session: SessionContext,
    input: ComputerStatusInput,
  ): Promise<ToolResult<ComputerTaskView>>;
  computerSteer(
    session: SessionContext,
    input: ComputerSteerInput,
  ): Promise<ToolResult<ComputerTaskView>>;
  computerCancel(
    session: SessionContext,
    input: { taskId: string },
  ): Promise<ToolResult<ComputerTaskView>>;
  computerScreenshot(session: SessionContext): Promise<ToolResult<{ screenshotPath: string }>>;
  /** Live task control for the Client API (UI timeline, steering, cancel). */
  controller?(): ComputerTasksControl;
}

export interface McpRoutineService {
  createRoutine(
    session: SessionContext,
    input: CreateRoutineInput,
  ): Promise<ToolResult<{ routineId: string; dryRunQueued: boolean }>>;
  listRoutines(session: SessionContext): Promise<ToolResult<{ routines: unknown[] }>>;
  updateRoutine(
    session: SessionContext,
    input: UpdateRoutineInput,
  ): Promise<ToolResult<{ routineId: string }>>;
  runRoutine(
    session: SessionContext,
    input: RunRoutineInput,
  ): Promise<ToolResult<{ runId: string; dryRun: boolean }>>;
}

export interface McpConnectorComposer {
  connectorServersForTurn(botId: string, connectionIds: string[]): Promise<McpServerSpec[]>;
}

export interface McpToolServices {
  runtime: McpRuntimeService;
  cos: McpCosService;
  computer: McpComputerService;
  routines: McpRoutineService;
  connectors?: McpConnectorComposer;
}
