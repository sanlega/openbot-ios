import type { Bot, ChainMode, MessageKind, PermissionPreset } from "@openbot/contracts";

/** Payload encoded in every per-turn `X-OpenBot-Session` token (plan §4.7). */
export interface SessionClaims {
  botId: string;
  turnId: string;
  chainId: string;
  mode: ChainMode;
  /** Unix ms — tokens expire after a turn ends or this timestamp, whichever comes first. */
  exp: number;
}

/** Resolved session after token verification plus roster lookup. */
export interface SessionContext extends SessionClaims {
  bot: Bot;
  isChiefOfStaff: boolean;
}

/** Gate/cap refusal shape (plan §4.9): a structured result, not an MCP error. */
export interface ToolRefusal {
  allowed: false;
  reason: string;
  suggestion?: string;
}

export type ToolSuccess<T> = { allowed: true } & T;

export type ToolResult<T> = ToolSuccess<T> | ToolRefusal;

export function refused(reason: string, suggestion?: string): ToolRefusal {
  return { allowed: false, reason, suggestion };
}

export function allowed<T extends Record<string, unknown>>(payload: T): ToolSuccess<T> {
  return { allowed: true, ...payload };
}

export interface SendMessageInput {
  bot: string;
  text: string;
}

export interface MessageUserInput {
  kind: MessageKind;
  body: string;
  options?: string[];
  deadline?: string;
  dedupe_key?: string;
}

export interface CreateBotInput {
  name: string;
  description: string;
  responsibility: string;
  why_not_existing: string;
  lifetime: "recurring" | "project" | "one_off";
  boundary: string[];
  user_requested: boolean;
  routing?: Bot["routing"];
  preset?: PermissionPreset;
}

export interface RequestApprovalInput {
  summary: string;
  detail: string;
}

export interface ComputerTaskInput {
  goal: string;
  startUrl?: string;
  maxSteps?: number;
  /** Text for fields, keyed by field label (e.g. {"Search": "openbot"}). */
  inputs?: Record<string, string>;
  /** How long to wait for the task before returning its progress (default 20 s, max 60). */
  waitSeconds?: number;
}

export interface ComputerStatusInput {
  taskId: string;
  waitSeconds?: number;
}

export interface ComputerSteerInput {
  taskId: string;
  instruction?: string;
  text?: string;
  waitSeconds?: number;
}

/** What the engine sees about a running or finished computer task. */
export type ComputerTaskView = {
  taskId: string;
  status: string;
  steps: number;
  summary?: string;
  /** Set when the task waits for text: answer with computer_steer({taskId, text}). */
  needsText?: string;
  /** Set while the task is paused on a step only the user can do (sign-in, a code, a CAPTCHA). */
  needs?: { kind: string; site?: string; message: string };
  /** What to do with this result: the harness's guidance for the current state. */
  next?: string;
  recentSteps: string[];
  /** While running: opening, looking, deciding, or acting. */
  phase?: string;
  /** The page at the last look: title, URL, and the labels of what's on screen. */
  page?: { url?: string; title?: string; visible?: string[] };
};

export interface CreateRoutineInput {
  name: string;
  prompt: string;
  trigger: unknown;
  limits?: unknown;
  botId?: string;
}

export interface UpdateRoutineInput {
  id: string;
  patch: Record<string, unknown>;
}

export interface RunRoutineInput {
  id: string;
  dryRun?: boolean;
}

export interface ReportDoneInput {
  summary: string;
  artifacts?: string[];
}
