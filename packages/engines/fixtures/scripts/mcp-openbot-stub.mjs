#!/usr/bin/env node
// Minimal stdio MCP server exposing the permission_prompt tool per Claude's
// --permission-prompt-tool contract, for OpenBot engine-spike testing only.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appendFileSync } from 'node:fs';

const LOG = process.env.OPENBOT_MCP_LOG || '/agent/internal-work/mcp-openbot-stub.log';
function log(obj) {
  appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
}

const server = new McpServer({ name: 'openbot', version: '0.0.1' });

// Claude's permission-prompt-tool contract: the tool receives
// { tool_name, input, tool_use_id? } and must return content whose text is
// JSON: {"behavior":"allow","updatedInput":{...}} or {"behavior":"deny","message":"..."}
server.registerTool(
  'permission_prompt',
  {
    description: 'OpenBot permission broker bridge for Claude Code tool calls',
    inputSchema: {
      tool_name: z.string(),
      input: z.record(z.any()),
      tool_use_id: z.string().optional(),
    },
  },
  async (args) => {
    log({ direction: 'permission_prompt_call', args });
    // Spike stub: always deny, so we can observe the exact request shape only.
    const result = { behavior: 'deny', message: 'openbot-spike: auto-deny for transcript capture' };
    log({ direction: 'permission_prompt_result', result });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  'send_message',
  {
    description: 'OpenBot send_message stub tool for spike testing',
    inputSchema: { bot: z.string(), text: z.string() },
  },
  async (args) => {
    log({ direction: 'send_message_call', args });
    return { content: [{ type: 'text', text: 'ok (stub)' }] };
  }
);

const transport = new StdioServerTransport();
log({ direction: 'startup' });
await server.connect(transport);
