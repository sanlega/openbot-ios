import { z } from "zod";
import { InputField } from "@openbot/contracts";

export const SendMessageSchema = z.object({
  bot: z.string().min(1),
  text: z.string().min(1),
});

export const MessageUserSchema = z.object({
  kind: z.enum(["result", "decision", "blocker"]),
  body: z.string().min(1),
  options: z.array(z.string()).optional(),
  deadline: z.string().datetime({ offset: true }).optional(),
  dedupe_key: z.string().optional(),
});

export const CreateBotSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  responsibility: z.string().min(1),
  why_not_existing: z.string().min(1),
  lifetime: z.enum(["recurring", "project", "one_off"]),
  boundary: z.array(z.string()),
  user_requested: z.boolean(),
  routing: z
    .object({
      mode: z.enum(["auto", "pinned"]),
      engine: z.enum(["claude", "codex", "fake"]).optional(),
      model: z.string().optional(),
      effort: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
  preset: z.enum(["read_only", "workspace_write", "full"]).optional(),
});

export const RequestApprovalSchema = z.object({
  summary: z.string().min(1),
  detail: z.string().min(1),
});

export const ComputerTaskSchema = z.object({
  goal: z.string().min(1),
  startUrl: z.string().url().optional(),
  maxSteps: z.number().int().positive().max(200).optional(),
  inputs: z.record(z.string(), z.string()).optional(),
  waitSeconds: z.number().min(0).max(60).optional(),
});

export const ComputerStatusSchema = z.object({
  taskId: z.string().min(1),
  waitSeconds: z.number().min(0).max(60).optional(),
});

export const ComputerSteerSchema = z
  .object({
    taskId: z.string().min(1),
    instruction: z.string().min(1).optional(),
    text: z.string().optional(),
    waitSeconds: z.number().min(0).max(60).optional(),
  })
  .refine((v) => v.instruction !== undefined || v.text !== undefined, {
    message: "give an instruction, text, or both",
  });

export const CreateRoutineSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  trigger: z.unknown(),
  limits: z.unknown().optional(),
  botId: z.string().optional(),
});

export const UpdateRoutineSchema = z.object({
  id: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});

export const RunRoutineSchema = z.object({
  id: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export const ReportDoneSchema = z.object({
  summary: z.string().min(1),
  artifacts: z.array(z.string()).optional(),
});

export const GetBotStatusSchema = z.object({
  bot: z.string().min(1),
});

export const PermissionPromptSchema = z.object({
  tool_name: z.string().min(1),
  input: z.unknown(),
});

export const TOOL_INPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  send_message: SendMessageSchema,
  message_user: MessageUserSchema,
  create_bot: CreateBotSchema,
  request_approval: RequestApprovalSchema,
  computer_task: ComputerTaskSchema,
  computer_status: ComputerStatusSchema,
  computer_steer: ComputerSteerSchema,
  computer_cancel: z.object({ taskId: z.string().min(1) }),
  computer_screenshot: z.object({}),
  create_routine: CreateRoutineSchema,
  update_routine: UpdateRoutineSchema,
  run_routine: RunRoutineSchema,
  report_done: ReportDoneSchema,
  get_bot_status: GetBotStatusSchema,
  list_bots: z.object({}),
  ask_user: z.object({
    title: z.string().min(1).max(200),
    intro: z.string().max(2000).optional(),
    fields: z.array(InputField).min(1).max(20),
  }),
  cancel_input: z.object({ request_id: z.string().min(1) }),
  archive_bot: z.object({
    bot: z.string().min(1),
    reason: z.string().min(1),
    user_requested: z.boolean().default(false),
  }),
  list_logins: z.object({}),
  save_login: z.object({
    site: z.string().min(1),
    username: z.string().optional(),
    password: z.string().optional(),
  }),
  list_routines: z.object({}),
  permission_prompt: PermissionPromptSchema,
};
