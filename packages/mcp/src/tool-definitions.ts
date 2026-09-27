import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/** MCP tool metadata advertised by the stdio shim (plan §4.9). */
export const OPENBOT_TOOL_DEFINITIONS: Tool[] = [
  {
    name: "list_bots",
    description: "List the bot roster with id, slug, name, and status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_bot_status",
    description: "Return per-bot state for a slug or id.",
    inputSchema: {
      type: "object",
      properties: { bot: { type: "string", description: "Bot slug or id" } },
      required: ["bot"],
      additionalProperties: false,
    },
  },
  {
    name: "create_bot",
    description: "Create a new bot (Chief of Staff only). Runs spawn caps and the Jev spawn gate.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        responsibility: { type: "string" },
        why_not_existing: { type: "string" },
        lifetime: { type: "string", enum: ["recurring", "project", "one_off"] },
        boundary: { type: "array", items: { type: "string" } },
        user_requested: { type: "boolean" },
        routing: { type: "object" },
        preset: { type: "string", enum: ["read_only", "workspace_write", "full"] },
      },
      required: [
        "name",
        "description",
        "responsibility",
        "why_not_existing",
        "lifetime",
        "boundary",
        "user_requested",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "send_message",
    description: "Send an asynchronous bot-to-bot message (hop+1).",
    inputSchema: {
      type: "object",
      properties: {
        bot: { type: "string", description: "Target bot slug or id" },
        text: { type: "string" },
      },
      required: ["bot", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "message_user",
    description: "Message the user proactively. Runs notify caps and the Jev notify gate.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["result", "decision", "blocker"] },
        body: { type: "string" },
        options: { type: "array", items: { type: "string" } },
        deadline: { type: "string" },
        dedupe_key: { type: "string" },
      },
      required: ["kind", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "request_approval",
    description: "Request user approval for a risky action (rate-limited).",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        detail: { type: "string" },
      },
      required: ["summary", "detail"],
      additionalProperties: false,
    },
  },
  {
    name: "computer_task",
    description: "Run a computer-use task on this bot's screen via the Jev fast loop.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        startUrl: { type: "string" },
        maxSteps: { type: "number" },
      },
      required: ["goal"],
      additionalProperties: false,
    },
  },
  {
    name: "computer_screenshot",
    description: "Capture a screenshot from this bot's screen for escalation.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_routine",
    description: "Create a routine for this bot (CoS may pass botId for another bot).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        prompt: { type: "string" },
        trigger: { type: "object" },
        limits: { type: "object" },
        botId: { type: "string" },
      },
      required: ["name", "prompt", "trigger"],
      additionalProperties: false,
    },
  },
  {
    name: "list_routines",
    description: "List routines owned by this bot (CoS sees all).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "update_routine",
    description: "Patch a routine (cannot raise limits above defaults).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        patch: { type: "object" },
      },
      required: ["id", "patch"],
      additionalProperties: false,
    },
  },
  {
    name: "run_routine",
    description: "Run a routine, optionally as a dry run.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        dryRun: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "report_done",
    description: "Report task completion for the Chief of Staff digest.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        artifacts: { type: "array", items: { type: "string" } },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  {
    name: "permission_prompt",
    description:
      "Claude permission-prompt-tool hook. Routed to the broker (not in the model tools list for Codex).",
    inputSchema: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        input: {},
      },
      required: ["tool_name"],
      additionalProperties: false,
    },
  },
];

/** Tools only injected into the Chief of Staff session (plan §4.9). */
export const COS_ONLY_TOOLS = new Set(["create_bot"]);

/** Tools exposed to every bot session. */
export const BASE_TOOLS = OPENBOT_TOOL_DEFINITIONS.filter((t) => !COS_ONLY_TOOLS.has(t.name));
