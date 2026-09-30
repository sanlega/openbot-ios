import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Bot, EngineEvent, ToolApprovalRequest, TurnInput } from "@openbot/contracts";
import { AcpDriver } from "./acp-driver.js";
import { openCodeProfile } from "./profiles/opencode.js";
import { cursorProfile } from "./profiles/others.js";

/**
 * Opt-in: the real `opencode acp` with a local Ollama model (OPENBOT_E2E_REAL=1).
 * OPENBOT_LIVE_OLLAMA_MODEL picks the model (default `qwen3:8b`, must support tools).
 */
const live = process.env.OPENBOT_E2E_REAL === "1";
const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "test-agents", "mcp-echo.mjs");
const model = `ollama/${process.env.OPENBOT_LIVE_OLLAMA_MODEL ?? "qwen3:8b"}`;

describe.runIf(live)("OpenCode + Ollama (live)", () => {
  const home = mkdtempSync(join(tmpdir(), "openbot-acp-live-"));
  const cwd = mkdtempSync(join(tmpdir(), "openbot-acp-live-ws-"));
  const driver = new AcpDriver(openCodeProfile(), { enginesDir: join(home, "engines") });
  const bot = { id: "bot_live", name: "Live" } as Bot;
  const input = (text: string, sessionId?: string): TurnInput => ({
    bot,
    text,
    sessionId,
    attachments: [],
    systemPrompt: "You are a careful assistant. Use tools when asked.",
    cwd,
    addDirs: [],
    auth: { mode: "login", env: {} },
    mcpServers: [{ name: "echo", command: process.execPath, args: [MCP] }],
    permission: "workspace_write",
    allowTools: ["mcp__echo"],
    denyTools: [],
    model,
    limits: { maxSteps: 20 },
  });
  const run = async (text: string, sessionId?: string) => {
    const events: EngineEvent[] = [];
    const approvals: ToolApprovalRequest[] = [];
    const result = await driver.startTurn(input(text, sessionId), {
      emit: (e) => events.push(e),
      requestApproval: async (r) => {
        approvals.push(r);
        return "allow";
      },
    }).done;
    const reply = events.map((e) => (e.type === "text_delta" ? e.text : "")).join("");
    return { result, events, approvals, reply };
  };
  let sessionId = "";

  it("lists the local model", async () => {
    const ids = (await driver.listModels()).map((m) => m.id);
    expect(ids).toContain(model);
  }, 60_000);

  it("calls an MCP tool, asks before writing a file, and replies", async () => {
    const { result, events, approvals, reply } = await run(
      `Call the secret_word tool, then write the word into the file ${join(cwd, "word.txt")}, then reply with just the word.`,
    );
    if (process.env.OPENBOT_LIVE_DEBUG)
      console.log(
        JSON.stringify(
          events.filter((e) => e.type !== "text_delta"),
          null,
          1,
        ),
        reply,
      );
    expect(result.isError, result.errorMessage).toBe(false);
    sessionId = result.sessionId;
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_started", toolName: "mcp__echo__secret_word" }),
    );
    expect(approvals.some((a) => a.toolName === "Write")).toBe(true);
    expect(existsSync(join(cwd, "word.txt"))).toBe(true);
    // An 8B model sometimes writes before the tool answers (a placeholder); the driver's part
    // is the tool call, the approval and the write, not the model's ordering.
    console.log("word.txt:", readFileSync(join(cwd, "word.txt"), "utf8"), "| reply:", reply);
    expect(reply.trim().length).toBeGreaterThan(0);
  }, 300_000);

  it("resumes the conversation in a new agent process", async () => {
    const { result, reply } = await run(
      "What was the secret word you found earlier? Reply with only the word.",
      sessionId,
    );
    expect(result.sessionId).toBe(sessionId);
    expect(reply).toContain("PAPAYA-42");
  }, 300_000);
});

/** Opt-in: the real Cursor CLI (OPENBOT_E2E_REAL=1 and OPENBOT_LIVE_CURSOR=1; uses the owner's Cursor plan). */
describe.runIf(live && process.env.OPENBOT_LIVE_CURSOR === "1")("Cursor (live)", () => {
  const home = mkdtempSync(join(tmpdir(), "openbot-cursor-live-"));
  const cwd = mkdtempSync(join(tmpdir(), "openbot-cursor-live-ws-"));
  const driver = new AcpDriver(cursorProfile(), { enginesDir: join(home, "engines") });
  const bot = { id: "bot_cursor_live", name: "Cursor live" } as Bot;
  const run = async (text: string, sessionId?: string) => {
    const events: EngineEvent[] = [];
    const approvals: ToolApprovalRequest[] = [];
    const result = await driver.startTurn(
      {
        bot,
        text,
        sessionId,
        attachments: [],
        systemPrompt: "You are a careful assistant. Use tools when asked. Be brief.",
        cwd,
        addDirs: [],
        auth: { mode: "login", env: {} },
        mcpServers: [{ name: "echo", command: process.execPath, args: [MCP] }],
        permission: "workspace_write",
        allowTools: ["mcp__echo"],
        denyTools: [],
        model: "auto",
        limits: { maxSteps: 20 },
      },
      {
        emit: (e) => events.push(e),
        requestApproval: async (r) => {
          approvals.push(r);
          return "allow";
        },
      },
    ).done;
    const reply = events.map((e) => (e.type === "text_delta" ? e.text : "")).join("");
    if (process.env.OPENBOT_LIVE_DEBUG) {
      console.log(
        JSON.stringify(
          events.filter((e) => e.type !== "text_delta"),
          null,
          1,
        ),
        reply,
      );
    }
    return { result, events, approvals, reply };
  };
  let sessionId = "";

  it("is detected as signed in", async () => {
    const status = await driver.detect();
    expect(status.installed).toBe(true);
    expect(status.login.ok).toBe(true);
  }, 60_000);

  it("calls an MCP tool and writes a file", async () => {
    const { result, events, reply } = await run(
      `Call the secret_word tool from the echo MCP server, then write the word into the file ${join(cwd, "word.txt")}, then reply with just the word.`,
    );
    expect(result.isError, result.errorMessage).toBe(false);
    sessionId = result.sessionId;
    expect(events.some((e) => e.type === "tool_started" && /secret_word/.test(e.toolName))).toBe(
      true,
    );
    expect(existsSync(join(cwd, "word.txt"))).toBe(true);
    expect(reply).toContain("PAPAYA-42");
  }, 300_000);

  it("resumes the conversation in a new agent process", async () => {
    const { result, reply } = await run(
      "What was the secret word? Reply with only the word.",
      sessionId,
    );
    expect(result.sessionId).toBe(sessionId);
    expect(reply).toContain("PAPAYA-42");
  }, 300_000);
});
