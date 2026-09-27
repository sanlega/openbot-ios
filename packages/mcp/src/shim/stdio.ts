#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BASE_TOOLS, COS_ONLY_TOOLS, OPENBOT_TOOL_DEFINITIONS } from "../tool-definitions.js";

const API_URL = process.env.OPENBOT_API_URL ?? "http://127.0.0.1:0";
const SESSION_TOKEN = process.env.OPENBOT_SESSION_TOKEN;
const COS_TOOLS = process.env.OPENBOT_COS_TOOLS === "1";

async function forwardTool(name: string, args: unknown): Promise<unknown> {
  if (!SESSION_TOKEN) {
    return { allowed: false, reason: "missing OPENBOT_SESSION_TOKEN" };
  }

  const response = await fetch(`${API_URL}/internal/tools/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-openbot-session": SESSION_TOKEN,
    },
    body: JSON.stringify(args ?? {}),
  });

  if (response.status === 401) {
    return { allowed: false, reason: "session token rejected" };
  }

  return response.json();
}

async function main(): Promise<void> {
  const tools = COS_TOOLS ? OPENBOT_TOOL_DEFINITIONS : BASE_TOOLS;

  const server = new Server(
    { name: "openbot-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    if (COS_ONLY_TOOLS.has(toolName) && !COS_TOOLS) {
      const payload = {
        allowed: false,
        reason: `${toolName} is only available to the Chief of Staff`,
        suggestion: "delegate to the CoS or reuse an existing bot",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        isError: false,
      };
    }

    const result = await forwardTool(toolName, request.params.arguments ?? {});
    const text = JSON.stringify(result);
    const isRefusal =
      typeof result === "object" &&
      result !== null &&
      "allowed" in result &&
      (result as { allowed: boolean }).allowed === false;

    return {
      content: [{ type: "text", text }],
      isError: isRefusal,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
