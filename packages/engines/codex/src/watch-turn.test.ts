import type { ToolApprovalRequest } from "@openbot/contracts";
import { describe, expect, it } from "vitest";
import { CodexAppServer } from "./app-server.js";
import { createCodexParseState } from "./parse-events.js";

/** Drives the shared app-server's notification stream without starting a real Codex process. */
function harness() {
  const server = new CodexAppServer();
  const answered: Array<{ id: number | string; result: unknown }> = [];
  (
    server as unknown as { respondToServerRequest: (id: number | string, r: unknown) => void }
  ).respondToServerRequest = (id, result) => void answered.push({ id, result });
  const emit = (message: Record<string, unknown>) =>
    (
      server as unknown as { notifications: { emit: (e: string, m: unknown) => void } }
    ).notifications.emit("msg", { jsonrpc: "2.0", ...message });
  const asked: ToolApprovalRequest[] = [];
  const state = createCodexParseState();
  state.threadId = "thread-mine";
  server.watchTurn(state, {
    emit: () => undefined,
    requestApproval: async (r) => {
      asked.push(r);
      return "allow";
    },
  });
  return { emit, asked, answered };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

describe("watchTurn on the shared app-server", () => {
  it("answers approvals for its own thread, in each request's own reply shape", async () => {
    const { emit, asked, answered } = harness();
    emit({
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-mine", command: "git status" },
    });
    emit({
      id: 8,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "thread-mine",
        serverName: "openbot",
        mode: "form",
        _meta: { codex_approval_kind: "mcp_tool_call", tool_params: {} },
        message: 'Allow the openbot MCP server to run tool "list_bots"?',
      },
    });
    await settle();
    expect(asked.map((a) => a.toolName)).toEqual(["shell", "mcp__openbot__list_bots"]);
    expect(answered).toEqual([
      { id: 7, result: { decision: "accept" } },
      { id: 8, result: { action: "accept", content: {} } },
    ]);
  });

  it("leaves another Bot's approvals alone: they are that Bot's to answer", async () => {
    const { emit, asked, answered } = harness();
    emit({
      id: 9,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-someone-else", command: "rm -rf /" },
    });
    await settle();
    expect(asked).toEqual([]);
    expect(answered).toEqual([]);
  });
});
