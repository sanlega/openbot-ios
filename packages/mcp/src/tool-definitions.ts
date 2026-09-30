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
    name: "archive_bot",
    description:
      "Remove a bot from the roster (Chief of Staff only). Archiving is reversible: its history is kept. Archive a user-created bot only when the user asked for it (user_requested: true).",
    inputSchema: {
      type: "object",
      properties: {
        bot: { type: "string", description: "Bot slug, id, or name" },
        reason: { type: "string" },
        user_requested: { type: "boolean" },
      },
      required: ["bot", "reason"],
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
    name: "ask_user",
    description:
      "Ask the user for information you need, as a short form instead of questions in text. Use it whenever you have 2+ questions, a choice between options, a yes/no, or need a secret (API key, password: use type 'secret', you get a reference, never the value). Keep it short (1-7 fields), mark only truly needed fields required. After calling it, END YOUR TURN: the answers arrive later as the user's next message.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What the form is about, e.g. 'About you'" },
        intro: { type: "string", description: "One or two sentences on why you ask" },
        fields: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "snake_case key for the answer" },
              type: {
                type: "string",
                enum: ["text", "number", "choice", "confirm", "date", "secret"],
              },
              label: { type: "string" },
              help: { type: "string" },
              required: { type: "boolean" },
              multiline: { type: "boolean", description: "text: long answer" },
              placeholder: { type: "string" },
              options: {
                type: "array",
                items: { type: "string" },
                description: "choice: 2-20 options",
              },
              multiple: { type: "boolean", description: "choice: allow several" },
              allowOther: { type: "boolean", description: "choice: allow a free answer" },
              min: { type: "number" },
              max: { type: "number" },
            },
            required: ["id", "type", "label"],
          },
        },
      },
      required: ["title", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_input",
    description: "Withdraw a form you sent with ask_user that is no longer needed.",
    inputSchema: {
      type: "object",
      properties: { request_id: { type: "string" } },
      required: ["request_id"],
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
    description:
      "Operate this bot's computer (browser/desktop) toward a goal. Jev picks each click/type/key step from what's on screen; OpenBot runs it. Ordinary steps (clicking, sending, connecting, posting, signing in) never ask the user; only spending money or deleting data does. The task recovers from setbacks on its own and pauses (status needs_user) only for a sign-in with no saved login, a code or a CAPTCHA, then continues by itself. You author any text to type: pass it in `inputs` keyed by field label, or answer later with computer_steer when the result says needsText. Returns after `waitSeconds` (default 20) with progress; every result has a `next` field saying what to do: follow it, and keep calling computer_status until the task is completed.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "What should be true when the task is done" },
        startUrl: { type: "string", description: "Page to open first" },
        maxSteps: { type: "number" },
        inputs: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            'Text for fields by label, e.g. {"Search": "openbot"}. A value may be a `secret:` reference from ask_user; the host types the real value. Saved logins are typed automatically at sign-in forms.',
        },
        waitSeconds: { type: "number", description: "0–60; default 20" },
      },
      required: ["goal"],
      additionalProperties: false,
    },
  },
  {
    name: "list_logins",
    description:
      "Websites the user has saved a login for (site and username only; you never see passwords). Check this before asking the user for a password: a saved login is typed into the virtual machine automatically when a computer_task reaches that site's sign-in form.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "save_login",
    description:
      "Save a NEW website login so computer_task can sign in on its own from now on. You cannot change or remove a saved login: the owner does that in Settings. Ask the user with ask_user first: a text field for the username and a 'secret' field for the password, then pass the username and the password's `secret:` reference here. The password goes to the vault; you never see it.",
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string", description: "The website, e.g. example.com" },
        username: { type: "string", description: "The username, or a secret: reference" },
        password: { type: "string", description: "A secret: reference from ask_user" },
      },
      required: ["site"],
      additionalProperties: false,
    },
  },
  {
    name: "computer_status",
    description: "Progress of a computer task: status, recent steps, and any text it needs.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" }, waitSeconds: { type: "number" } },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  {
    name: "computer_steer",
    description:
      "Guide a computer task: add an instruction for the next steps, and/or give the text it asked for (needsText). Also the way to continue a task that is paused for the user (after saving a login) or that stopped short (escalated/failed): it resumes from the same page with the same history, so prefer this to starting over.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        instruction: { type: "string" },
        text: { type: "string" },
        waitSeconds: { type: "number" },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  {
    name: "computer_cancel",
    description: "Stop a computer task.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  {
    name: "computer_screenshot",
    description:
      "See this bot's screen now: the page title, URL, and the labels of what's on it (plus an image path when the computer can capture one).",
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
export const COS_ONLY_TOOLS = new Set(["create_bot", "archive_bot"]);

/** Tools exposed to every bot session. */
export const BASE_TOOLS = OPENBOT_TOOL_DEFINITIONS.filter((t) => !COS_ONLY_TOOLS.has(t.name));
