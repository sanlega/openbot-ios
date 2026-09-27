import { z } from "zod";
import {
  ComputerAccess,
  EngineAuthOverride,
  EngineRouting,
  MessageDelivery,
  PermissionPreset,
  RoutineLimits,
  RoutineTrigger,
} from "@openbot/contracts";

/** Request-body schemas for the §4.7 Client API. Entity shapes themselves reuse `@openbot/contracts` directly. */

export const CreateBotBody = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  description: z.string().default(""),
  avatar: z.string().optional(),
  pinned: z.boolean().default(false),
  hidden: z.boolean().default(false),
  isChiefOfStaff: z.boolean().default(false),
  routing: EngineRouting.default({ mode: "auto" }),
  auth: EngineAuthOverride.optional(),
  permissionPreset: PermissionPreset.default("workspace_write"),
  computer: ComputerAccess.default("none"),
  connectors: z.array(z.string()).default([]),
  limits: z
    .object({ dailyUsd: z.number().nonnegative().optional(), dailyTokens: z.number().int().nonnegative().optional() })
    .default({}),
});
export type CreateBotBody = z.infer<typeof CreateBotBody>;

export const UpdateBotBody = z.object({
  name: z.string().min(1).optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  avatar: z.string().optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
  routing: EngineRouting.optional(),
  auth: EngineAuthOverride.optional(),
  permissionPreset: PermissionPreset.optional(),
  computer: ComputerAccess.optional(),
  connectors: z.array(z.string()).optional(),
  limits: z
    .object({ dailyUsd: z.number().nonnegative().optional(), dailyTokens: z.number().int().nonnegative().optional() })
    .optional(),
});
export type UpdateBotBody = z.infer<typeof UpdateBotBody>;

export const RouteOverrideBody = EngineRouting;

export const MessagesQuery = z.object({
  delivery: MessageDelivery.optional(),
});

export const ActivityQuery = z.object({
  botId: z.string().optional(),
  delivery: MessageDelivery.optional(),
});

export const ResolveApprovalBody = z.object({
  resolution: z.enum(["allow", "deny"]),
});

export const CreateRuleBody = z.object({
  scope: z.string().default("global"),
  match: z.object({
    tool: z.string().optional(),
    computerOp: z.string().optional(),
    connectorAction: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
  effect: z.enum(["allow", "ask", "deny"]),
});
export type CreateRuleBody = z.infer<typeof CreateRuleBody>;

export const PairDeviceBody = z.object({
  name: z.string().min(1),
  role: z.enum(["owner", "approver"]).optional(),
  via: z.enum(["lan", "tailscale", "cloudflare"]).default("lan"),
});
export type PairDeviceBody = z.infer<typeof PairDeviceBody>;

export const UpdateSettingsBody = z.object({
  caps: z.record(z.string(), z.number()).optional(),
  budgets: z.record(z.string(), z.number()).optional(),
  quietHours: z.object({ enabled: z.boolean(), start: z.string(), end: z.string() }).optional(),
});
export type UpdateSettingsBody = z.infer<typeof UpdateSettingsBody>;

export const SetupValidateBody = z.object({
  kind: z.enum([
    "typesafe",
    "anthropic",
    "openai",
    "claude_login",
    "codex_login",
    "composio",
    "tailscale",
    "cloudflare",
  ]),
  value: z.string().optional(),
});
export type SetupValidateBody = z.infer<typeof SetupValidateBody>;

export const CreateRoutineBody = z.object({
  botId: z.string(),
  name: z.string().min(1),
  prompt: z.string().min(1),
  trigger: RoutineTrigger,
  limits: RoutineLimits,
});
export type CreateRoutineBody = z.infer<typeof CreateRoutineBody>;

export const UpdateRoutineBody = z.object({
  name: z.string().optional(),
  prompt: z.string().optional(),
  enabled: z.boolean().optional(),
  trigger: RoutineTrigger.optional(),
  limits: RoutineLimits.optional(),
});
export type UpdateRoutineBody = z.infer<typeof UpdateRoutineBody>;

export const RunRoutineBody = z.object({
  dryRun: z.boolean().default(true),
});

export const BotConnectorsBody = z.object({
  connectors: z.array(z.string()),
});

export const TakeoverBody = z.object({
  on: z.boolean(),
});

export const CloudflareTunnelBody = z.object({
  token: z.string().min(1),
});

export const DecisionsQuery = z.object({
  purpose: z.string().optional(),
});
