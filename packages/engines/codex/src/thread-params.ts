import type { TurnInput } from "@openbot/contracts";

type Preset = TurnInput["permission"];

/**
 * Codex's sandbox. OpenBot's permission broker is the policy (built-in denies, workspace rules,
 * Jev's risk gate, approval cards), exactly as it is for Claude; every command that is not
 * plainly read-only is sent to it first (`approvalPolicy: "untrusted"`). So Bots that may write get
 * an unrestricted sandbox (Codex's own one blocks the network and, on Windows, needs a setup that a
 * private home doesn't have), and only read-only Bots stay in Codex's read-only sandbox.
 */
export function sandboxFor(preset: Preset): "read-only" | "danger-full-access" {
  return preset === "read_only" ? "read-only" : "danger-full-access";
}

/** What `thread/start` and `thread/resume` need, so a Bot's Codex thread behaves like its Claude one. */
export function threadParams(input: TurnInput): Record<string, unknown> {
  // `apps` is the ChatGPT account's connected apps (Drive, Gmail, ...): hundreds of tools with the
  // owner's own token that a Bot never asked for. Off.
  const config: Record<string, unknown> = { features: { apps: false } };
  if (input.mcpServers.length > 0) {
    const mcp_servers: Record<string, unknown> = {};
    for (const server of input.mcpServers) {
      mcp_servers[server.name] = {
        command: server.command,
        args: server.args ?? [],
        env: server.env ?? {},
      };
    }
    config.mcp_servers = mcp_servers;
  }
  if (input.effort) config.model_reasoning_effort = input.effort;

  return {
    cwd: input.cwd,
    model: input.model,
    approvalPolicy: "untrusted",
    sandbox: sandboxFor(input.permission),
    // The Bot's own instructions (Chief of Staff rules, computer rules, ...) — without this a Codex
    // Bot is a bare model call that has never heard of OpenBot.
    ...(input.systemPrompt ? { developerInstructions: input.systemPrompt } : {}),
    config,
  };
}

/** `powershell -Command '...'`, `cmd /c ...`, `bash -lc '...'` → the command inside, for the broker. */
export function unwrapShell(command: string): string {
  const quoted = /(?:-command|-c|-lc|\/c)\s+(["'])([\s\S]*)\1\s*$/i.exec(command);
  if (quoted) return quoted[2] ?? command;
  const bare = /(?:-command|\/c)\s+([\s\S]+)$/i.exec(command);
  return bare?.[1]?.trim() || command;
}

export interface MappedApproval {
  /** What the runtime's permission broker sees as the tool. */
  toolName: string;
  input: Record<string, unknown>;
  /** Codex's answer for each outcome (the response shape differs per request kind). */
  respond(allow: boolean): unknown;
  /** True when OpenBot has nobody to ask (a form an MCP server wants filled): answer at once. */
  autoAnswer?: unknown;
}

const decision = (allow: boolean) => ({ decision: allow ? "accept" : "decline" });

/**
 * Codex asks the client to approve commands, file changes, extra permissions and MCP tool calls, and
 * each has its own reply shape. Answering an MCP tool call with `{ decision }` (the command shape)
 * made Codex treat it as rejected: OpenBot's own tools never worked under Codex.
 */
export function mapApprovalRequest(
  method: string,
  params: Record<string, unknown>,
  pathsFor: (itemId: string) => string[] | undefined = () => undefined,
): MappedApproval {
  if (method === "item/commandExecution/requestApproval") {
    const raw = typeof params.command === "string" ? params.command : "";
    return {
      toolName: "shell",
      input: { command: unwrapShell(raw), rawCommand: raw, cwd: params.cwd, reason: params.reason },
      respond: decision,
    };
  }

  if (method === "item/fileChange/requestApproval") {
    const itemId = typeof params.itemId === "string" ? params.itemId : "";
    const paths = pathsFor(itemId) ?? [];
    return {
      toolName: "apply_patch",
      input: {
        file_path: paths[0],
        paths,
        reason: params.reason,
        grantRoot: params.grantRoot,
      },
      respond: decision,
    };
  }

  if (method === "item/permissions/requestApproval") {
    return {
      toolName: "request_permissions",
      input: params,
      respond: (allow) =>
        allow
          ? { permissions: params.permissions ?? {}, scope: "turn" }
          : { permissions: {}, scope: "turn" },
    };
  }

  if (method === "item/tool/requestUserInput") {
    // The model's own "ask the user" tool. A Bot asks through OpenBot's ask_user; nobody is here to type.
    return {
      toolName: "request_user_input",
      input: params,
      respond: () => ({ answers: {} }),
      autoAnswer: { answers: {} },
    };
  }

  if (method === "mcpServer/elicitation/request") {
    const meta = (params._meta ?? {}) as { codex_approval_kind?: string; tool_params?: unknown };
    const server = String(params.serverName ?? "mcp");
    if (meta.codex_approval_kind === "mcp_tool_call") {
      const tool = /run tool "([^"]+)"/.exec(String(params.message ?? ""))?.[1] ?? "tool";
      const args =
        meta.tool_params && typeof meta.tool_params === "object"
          ? (meta.tool_params as Record<string, unknown>)
          : {};
      return {
        toolName: `mcp__${server}__${tool}`,
        input: args,
        respond: (allow) =>
          allow ? { action: "accept", content: {} } : { action: "decline", content: null },
      };
    }
    // An MCP server asking for form input: there is no user to type it in a Bot's turn.
    return {
      toolName: `mcp__${server}__elicitation`,
      input: { message: params.message },
      respond: () => ({ action: "cancel", content: null }),
      autoAnswer: { action: "cancel", content: null },
    };
  }

  return { toolName: method, input: params, respond: decision };
}
