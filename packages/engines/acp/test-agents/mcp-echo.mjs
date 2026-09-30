// A minimal MCP stdio server for live tests: one tool, `secret_word`, that returns PAPAYA-42.
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
rl.on("line", (l) => {
  const m = JSON.parse(l);
  if (m.method === "initialize")
    send({
      jsonrpc: "2.0",
      id: m.id,
      result: {
        protocolVersion: m.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "echo", version: "1" },
      },
    });
  else if (m.method === "tools/list")
    send({
      jsonrpc: "2.0",
      id: m.id,
      result: {
        tools: [
          {
            name: "secret_word",
            description: "Returns the secret word",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
  else if (m.method === "tools/call")
    send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "PAPAYA-42" }] } });
  else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} });
});
