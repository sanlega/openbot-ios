#!/usr/bin/env node
/**
 * Minimal MCP stdio server for connector integration tests. Speaks enough JSON-RPC
 * to satisfy health checks from MCP clients during manual verification.
 */
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on("line", (line) => {
  let msg: { id?: number; method?: string };
  try {
    msg = JSON.parse(line) as { id?: number; method?: string };
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "openbot-test-mcp", version: "0.0.1" },
        },
      })}\n`,
    );
    return;
  }
  if (msg.method === "tools/list") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: { tools: [{ name: "ping", description: "Ping", inputSchema: { type: "object" } }] },
      })}\n`,
    );
  }
});
