import type { TurnInput } from "@openbot/contracts";
import { describe, expect, it } from "vitest";
import { mapApprovalRequest, sandboxFor, threadParams, unwrapShell } from "./thread-params.js";

function turn(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    bot: { id: "bot_1" },
    text: "hi",
    attachments: [],
    systemPrompt: "You are the Chief of Staff.",
    cwd: "/work",
    addDirs: [],
    auth: { mode: "login", env: {} },
    mcpServers: [{ name: "openbot", command: "node", args: ["shim.js"], env: { A: "1" } }],
    permission: "workspace_write",
    allowTools: ["mcp__openbot"],
    denyTools: [],
    model: "gpt-5.5",
    effort: "medium",
    limits: { maxSteps: 50 },
    ...overrides,
  } as unknown as TurnInput;
}

describe("threadParams", () => {
  it("gives the thread the Bot's instructions, OpenBot's MCP server, and OpenBot's approvals", () => {
    const params = threadParams(turn());
    expect(params).toMatchObject({
      cwd: "/work",
      model: "gpt-5.5",
      // Every command that isn't plainly read-only is sent to OpenBot's permission broker first.
      approvalPolicy: "untrusted",
      developerInstructions: "You are the Chief of Staff.",
      config: {
        features: { apps: false },
        model_reasoning_effort: "medium",
        mcp_servers: { openbot: { command: "node", args: ["shim.js"], env: { A: "1" } } },
      },
    });
  });

  it("leaves out instructions and MCP config the Bot doesn't have", () => {
    const params = threadParams(turn({ systemPrompt: "", mcpServers: [], effort: undefined }));
    expect(params).not.toHaveProperty("developerInstructions");
    expect(params.config).toEqual({ features: { apps: false } });
  });

  it("uses Codex's read-only sandbox only for read-only Bots; the broker is the policy for the rest", () => {
    expect(sandboxFor("read_only")).toBe("read-only");
    expect(sandboxFor("workspace_write")).toBe("danger-full-access");
    expect(sandboxFor("full")).toBe("danger-full-access");
  });
});

describe("unwrapShell", () => {
  it.each([
    [
      `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'curl.exe -s https://example.com'`,
      "curl.exe -s https://example.com",
    ],
    [`bash -lc "git status && ls"`, "git status && ls"],
    [`cmd /c echo hi`, "echo hi"],
    ["git status", "git status"],
  ])("unwraps %s", (raw, inner) => {
    expect(unwrapShell(raw)).toBe(inner);
  });
});

describe("mapApprovalRequest, from requests captured off Codex 0.155", () => {
  it("names a command like every other engine's shell tool, with the command inside the wrapper", () => {
    const mapped = mapApprovalRequest("item/commandExecution/requestApproval", {
      threadId: "t",
      command: `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'echo hi'`,
      cwd: "C:\\work",
    });
    expect(mapped.toolName).toBe("shell");
    expect(mapped.input).toMatchObject({ command: "echo hi", cwd: "C:\\work" });
    expect(mapped.respond(true)).toEqual({ decision: "accept" });
    expect(mapped.respond(false)).toEqual({ decision: "decline" });
  });

  it("answers an MCP tool call in the elicitation shape (the command shape was read as 'rejected')", () => {
    const mapped = mapApprovalRequest("mcpServer/elicitation/request", {
      threadId: "t",
      turnId: "u",
      serverName: "openbot",
      mode: "form",
      _meta: {
        codex_approval_kind: "mcp_tool_call",
        persist: ["session", "always"],
        tool_params: { name: "Researcher" },
      },
      message: 'Allow the openbot MCP server to run tool "create_bot"?',
      requestedSchema: { type: "object", properties: {} },
    });
    expect(mapped.toolName).toBe("mcp__openbot__create_bot");
    expect(mapped.input).toEqual({ name: "Researcher" });
    expect(mapped.respond(true)).toEqual({ action: "accept", content: {} });
    expect(mapped.respond(false)).toEqual({ action: "decline", content: null });
  });

  it("cancels a form an MCP server wants filled in, without asking anyone", () => {
    const mapped = mapApprovalRequest("mcpServer/elicitation/request", {
      serverName: "some-server",
      mode: "form",
      _meta: null,
      message: "What is your name?",
      requestedSchema: {},
    });
    expect(mapped.autoAnswer).toEqual({ action: "cancel", content: null });
  });

  it("names a file change by the paths it will touch", () => {
    const mapped = mapApprovalRequest(
      "item/fileChange/requestApproval",
      { threadId: "t", itemId: "patch-1", reason: "write index.html" },
      (id) => (id === "patch-1" ? ["/work/index.html", "/work/app.js"] : undefined),
    );
    expect(mapped.toolName).toBe("apply_patch");
    expect(mapped.input).toMatchObject({
      file_path: "/work/index.html",
      paths: ["/work/index.html", "/work/app.js"],
    });
    expect(mapped.respond(true)).toEqual({ decision: "accept" });
  });

  it("answers the model's own ask-the-user tool with no answers instead of raising a card", () => {
    const mapped = mapApprovalRequest("item/tool/requestUserInput", {
      threadId: "t",
      questions: [{ id: "q", question: "Which one?" }],
    });
    expect(mapped.autoAnswer).toEqual({ answers: {} });
  });
});
