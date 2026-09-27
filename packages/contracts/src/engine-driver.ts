import type { Bot } from "./entities.js";

/**
 * Plan §4.3 (WS3 implements; WS2 calls). Drivers never touch the DB or the event
 * bus directly — they only emit `EngineEvent`s and answer approval requests
 * through the hooks passed into `startTurn`. `packages/engines/fake` implements
 * this same interface with zero real credentials, for every other workstream's
 * tests and CI.
 */
export interface EngineStatus {
  installed: boolean;
  version?: string;
  login: { ok: boolean; account?: string };
  apiKey: { ok: boolean };
}

export interface ModelInfo {
  id: string;
  label: string;
  contextWindow?: number;
}

export interface TurnInput {
  bot: Bot;
  sessionId?: string;
  text: string;
  attachments: string[];
  systemPrompt: string;
  cwd: string;
  addDirs: string[];
  auth: { mode: "login" | "api_key"; env: Record<string, string> };
  mcpServers: McpServerSpec[];
  permission: Bot["permissionPreset"];
  allowTools: string[];
  denyTools: string[];
  model: string;
  effort?: "low" | "medium" | "high";
  limits: { maxSteps: number; maxUsd?: number; maxTokens?: number };
}

export interface McpServerSpec {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type EngineEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; toolName: string; input: unknown; toolUseId: string }
  | { type: "tool_completed"; toolUseId: string; output: unknown; isError: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number; usd?: number }
  | { type: "session_started"; sessionId: string }
  | { type: "error"; message: string; authFailure?: boolean };

export interface ToolApprovalRequest {
  toolName: string;
  input: unknown;
  toolUseId: string;
}

export interface TurnHooks {
  emit(e: EngineEvent): void;
  requestApproval(r: ToolApprovalRequest): Promise<"allow" | "deny">;
}

export interface TurnResult {
  sessionId: string;
  isError: boolean;
  errorMessage?: string;
  usage: { inputTokens: number; outputTokens: number; usd?: number };
}

export interface TurnHandle {
  steer(text: string): Promise<void>;
  interrupt(): Promise<void>;
  done: Promise<TurnResult>;
}

export interface EngineDriver {
  /** `'claude' | 'codex' | 'fake'`. */
  id: string;
  detect(): Promise<EngineStatus>;
  validateKey(key: string): Promise<{ ok: boolean; reason?: string }>;
  listModels(): Promise<ModelInfo[]>;
  startTurn(input: TurnInput, hooks: TurnHooks): TurnHandle;
  dispose(): Promise<void>;
}
