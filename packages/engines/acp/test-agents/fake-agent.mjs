// A scripted ACP agent for tests (no model, no credentials). Directives in the prompt:
//   @tool <command>  run an "execute" tool that asks for permission first
//   @mcp             call the `openbot` MCP server's `message_user` tool
//   @slow            keep working until cancelled
//   @crash           exit with an error on stderr
//   @auth            fail as "authentication required"
//   @steps <n>       run n read-only tool calls
// Sessions persist in FAKE_ACP_STATE (one agent process per turn, like OpenBot runs them).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk";

const stateFile = join(process.env.FAKE_ACP_STATE ?? ".", "fake-acp-sessions.json");
const load = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {});
const save = (s) => writeFileSync(stateFile, JSON.stringify(s));
const resume = process.env.FAKE_ACP_RESUME === "1";
const MODELS = [
  { value: "m1", name: "Model One" },
  { value: "m2", name: "Model Two" },
];

let conn;
const live = {}; // sessionId -> { model, mcp, cancelled }

function configOptions(model) {
  return [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: model,
      options: MODELS,
    },
  ];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const agent = {
  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: resume ? { resume: {} } : {},
      },
      authMethods: [{ id: "fake_login", name: "Fake login" }],
    };
  },
  async authenticate() {
    return {};
  },
  async newSession(params) {
    const id = `fake_${Math.random().toString(36).slice(2, 10)}`;
    const all = load();
    all[id] = { history: [], model: "m1" };
    save(all);
    live[id] = { model: "m1", mcp: params.mcpServers.map((s) => s.name), cancelled: false };
    return { sessionId: id, configOptions: configOptions("m1") };
  },
  async loadSession(params) {
    const all = load();
    const s = all[params.sessionId];
    if (!s) throw RequestError.resourceNotFound(params.sessionId);
    live[params.sessionId] = {
      model: s.model,
      mcp: params.mcpServers.map((m) => m.name),
      cancelled: false,
    };
    for (const text of s.history) {
      await conn.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `REPLAY ${text}` },
        },
      });
    }
    return { configOptions: configOptions(s.model) };
  },
  async resumeSession(params) {
    const all = load();
    const s = all[params.sessionId];
    if (!s) throw RequestError.resourceNotFound(params.sessionId);
    live[params.sessionId] = {
      model: s.model,
      mcp: (params.mcpServers ?? []).map((m) => m.name),
      cancelled: false,
    };
    return { configOptions: configOptions(s.model) };
  },
  async setSessionConfigOption(params) {
    live[params.sessionId].model = params.value;
    const all = load();
    all[params.sessionId].model = params.value;
    save(all);
    return { configOptions: configOptions(params.value) };
  },
  async cancel(params) {
    if (live[params.sessionId]) live[params.sessionId].cancelled = true;
  },
  async prompt(params) {
    const sid = params.sessionId;
    const state = live[sid];
    const text = params.prompt
      .map((b) => (b.type === "text" ? b.text : `[${b.type}:${b.name ?? ""}]`))
      .join(" ");
    const say = (t) =>
      conn.sessionUpdate({
        sessionId: sid,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } },
      });
    const update = (u) => conn.sessionUpdate({ sessionId: sid, update: u });

    if (text.includes("@crash")) {
      process.stderr.write("boom: something broke\n");
      process.exit(3);
    }
    if (text.includes("@auth")) throw RequestError.authRequired();
    if (text.includes("@slow")) {
      for (let i = 0; i < 600 && !state.cancelled; i++) await sleep(50);
      return { stopReason: "cancelled" };
    }
    const steps = /@steps (\d+)/.exec(text);
    if (steps) {
      for (let i = 0; i < Number(steps[1]); i++) {
        if (state.cancelled) return { stopReason: "cancelled" };
        const id = `read_${i}`;
        await update({
          sessionUpdate: "tool_call",
          toolCallId: id,
          title: "read",
          kind: "read",
          status: "in_progress",
          rawInput: { filePath: `f${i}.txt` },
        });
        await update({
          sessionUpdate: "tool_call_update",
          toolCallId: id,
          status: "completed",
          rawOutput: { output: "ok" },
        });
        await sleep(10);
      }
    }
    const tool = /@tool (.+)/.exec(text);
    if (tool) {
      const id = "exec_1";
      await update({
        sessionUpdate: "tool_call",
        toolCallId: id,
        title: "bash",
        kind: "execute",
        status: "pending",
        rawInput: {},
      });
      await update({
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: "pending",
        rawInput: { command: tool[1].trim() },
      });
      const answer = await conn.requestPermission({
        sessionId: sid,
        toolCall: { toolCallId: id, kind: "execute", title: tool[1].trim() },
        options: [
          { optionId: "once", kind: "allow_once", name: "Allow once" },
          { optionId: "always", kind: "allow_always", name: "Always allow" },
          { optionId: "reject", kind: "reject_once", name: "Reject" },
        ],
      });
      const allowed = answer.outcome.outcome === "selected" && answer.outcome.optionId === "once";
      await update({
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: allowed ? "completed" : "failed",
        rawOutput: { output: allowed ? "ran" : "rejected" },
      });
      await say(
        allowed ? "allowed " : `denied(${answer.outcome.optionId ?? answer.outcome.outcome}) `,
      );
    }
    const write = /@write (\S+)/.exec(text);
    if (write) {
      // A file edit that never asks for permission (Cursor's behaviour).
      const id = "edit_1";
      await update({
        sessionUpdate: "tool_call",
        toolCallId: id,
        title: "Edit File",
        kind: "edit",
        status: "pending",
      });
      await update({
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: "in_progress",
        locations: [{ path: write[1] }],
      });
      await sleep(300);
      if (state.cancelled) return { stopReason: "cancelled" };
      await update({ sessionUpdate: "tool_call_update", toolCallId: id, status: "completed" });
    }
    if (text.includes("@mcp")) {
      await update({
        sessionUpdate: "tool_call",
        toolCallId: "mcp_1",
        title: "openbot_message_user",
        kind: "other",
        status: "pending",
        rawInput: {},
      });
      await update({
        sessionUpdate: "tool_call_update",
        toolCallId: "mcp_1",
        status: "completed",
        rawInput: { text: "hi" },
        content: [{ type: "content", content: { type: "text", text: "delivered" } }],
      });
    }
    const reply = `model=${state.model} mcp=${state.mcp.join(",")} instructions=${text.includes("<instructions>")} text=${text.replace(/<instructions>[\s\S]*<\/instructions>\s*/, "").slice(0, 60)}`;
    await say(reply);
    await update({
      sessionUpdate: "usage_update",
      used: 10,
      size: 1000,
      cost: { amount: 0.01, currency: "USD" },
    });
    const all = load();
    all[sid].history.push(reply);
    save(all);
    return { stopReason: "end_turn", usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } };
  },
};

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
conn = new AgentSideConnection(() => agent, stream);
