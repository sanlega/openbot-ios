import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { EngineEvent, ToolApprovalRequest, TurnInput } from "@openbot/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CodexDriver } from "./driver.js";

/**
 * Runs against the real `codex` CLI on this machine (its own login). Codex changes its app-server
 * protocol between releases, and a silent mismatch makes every Bot useless: replies come back empty,
 * the Bot never receives its instructions, or OpenBot's own MCP tools are answered as "rejected".
 * Each test here is one of those failures. Opt in with OPENBOT_E2E_REAL=1; never part of CI.
 */
const live = process.env.OPENBOT_E2E_REAL === "1";

let workdir = "";
let stubPath = "";

/** A tiny stdio MCP server; the SDK is imported from the mcp package, which depends on it. */
function mcpStub(): string {
  const requireFromMcp = createRequire(new URL("../../../mcp/package.json", import.meta.url));
  const sdk = (file: string) =>
    pathToFileURL(requireFromMcp.resolve(`@modelcontextprotocol/sdk/${file}`)).href;
  return `
import { Server } from "${sdk("server/index.js")}";
import { StdioServerTransport } from "${sdk("server/stdio.js")}";
import { CallToolRequestSchema, ListToolsRequestSchema } from "${sdk("types.js")}";
const s = new Server({ name: "openbot-mcp", version: "0" }, { capabilities: { tools: {} } });
s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "ping", description: "Returns the secret word. Use it when asked to ping.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] }));
s.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: JSON.stringify({ allowed: true, secret: "PINEAPPLE-42" }) }] }));
await s.connect(new StdioServerTransport());
`;
}

function input(text: string, extra: Partial<TurnInput> = {}): TurnInput {
  return {
    bot: { id: "bot_live", name: "live" },
    text,
    attachments: [],
    systemPrompt: "Be brief.",
    cwd: workdir,
    addDirs: [],
    auth: { mode: "login", env: {} },
    mcpServers: [],
    permission: "full",
    allowTools: [],
    denyTools: [],
    model: "gpt-5.5",
    limits: { maxSteps: 50 },
    ...extra,
  } as unknown as TurnInput;
}

async function runTurn(driver: CodexDriver, turn: TurnInput) {
  const events: EngineEvent[] = [];
  const approvals: ToolApprovalRequest[] = [];
  const result = await driver.startTurn(turn, {
    emit: (e) => events.push(e),
    requestApproval: async (r) => {
      approvals.push(r);
      return "allow";
    },
  }).done;
  const text = events
    .filter((e): e is Extract<EngineEvent, { type: "text_delta" }> => e.type === "text_delta")
    .map((e) => e.text)
    .join("");
  const session = events.find((e) => e.type === "session_started") as
    { sessionId: string } | undefined;
  return { events, approvals, result, text, sessionId: session?.sessionId };
}

describe.skipIf(!live)("Codex driver against the real CLI", () => {
  const driver = new CodexDriver();
  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), "ob-codex-live-"));
    stubPath = join(workdir, "mcp-stub.mjs");
    await writeFile(stubPath, mcpStub());
  });
  afterAll(async () => {
    await driver.dispose();
    await rm(workdir, { recursive: true, force: true });
  });

  it("returns the reply text and reports a shell command as a tool call", async () => {
    const { events, result, text } = await runTurn(
      driver,
      input("Run the shell command `echo hello-live` and tell me what it printed in one sentence."),
    );
    expect(result.isError).toBe(false);
    expect(text.toLowerCase()).toContain("hello-live");
    expect(events.some((e) => e.type === "tool_started")).toBe(true);
    expect(events.some((e) => e.type === "tool_completed")).toBe(true);
  }, 120_000);

  it("gives the Bot its instructions (a bare model call has never heard of OpenBot)", async () => {
    const { text } = await runTurn(
      driver,
      input("Introduce yourself in one short sentence.", {
        bot: { id: "bot_live_fresh", name: "fresh" } as TurnInput["bot"],
        systemPrompt:
          "You are the Chief of Staff of OpenBot. Start every reply with the exact word TESTBOT.",
      }),
    );
    expect(text.trim().startsWith("TESTBOT")).toBe(true);
  }, 120_000);

  it("applies instructions that change between turns (Codex fixes them when a thread is created)", async () => {
    const bot = { id: "bot_live_changing", name: "changing" } as TurnInput["bot"];
    await runTurn(driver, input("Reply only: ok.", { bot, systemPrompt: "Be brief." }));
    // Like a roster change: a fact the thread's own instructions never contained.
    const { text } = await runTurn(
      driver,
      input("What is the team's code word? Reply with just the word.", {
        bot,
        systemPrompt: "Be brief. Your team's code word is KUMQUAT-7. When asked for it, say it.",
      }),
    );
    expect(text, `reply was: ${text}`).toContain("KUMQUAT-7");
  }, 180_000);

  it("sends commands to OpenBot's approval flow as a shell tool, with the command visible", async () => {
    const { approvals, text } = await runTurn(
      driver,
      input("Run the shell command `echo approve-me` and say what it printed."),
    );
    const shell = approvals.find((a) => a.toolName === "shell");
    expect(shell, "a command approval named 'shell'").toBeDefined();
    expect(JSON.stringify(shell?.input)).toContain("approve-me");
    expect(text.toLowerCase()).toContain("approve-me");
  }, 120_000);

  it("lets the Bot call OpenBot's MCP tools (they were answered as 'rejected' before)", async () => {
    const { approvals, text, events } = await runTurn(
      driver,
      input(
        "Call the ping tool of the openbot MCP server, then tell me the secret word it returned.",
        {
          mcpServers: [
            {
              name: "openbot",
              command: process.execPath,
              args: [stubPath],
            },
          ],
        },
      ),
    );
    expect(approvals.some((a) => a.toolName === "mcp__openbot__ping")).toBe(true);
    expect(
      events.some((e) => e.type === "tool_started" && e.toolName === "mcp__openbot__ping"),
    ).toBe(true);
    expect(text).toContain("PINEAPPLE-42");
  }, 120_000);

  it("leaves every skill (the owner's, Codex's, the account's plugins') out of a Bot's thread", async () => {
    const bot = { id: "bot_live_skills", name: "skills" } as TurnInput["bot"];
    await runTurn(driver, input("Reply only: ok.", { bot }));
    // Plugin skills sync in a few seconds after Codex starts; the next turn switches them off too.
    await new Promise((r) => setTimeout(r, 8_000));
    await runTurn(driver, input("Reply only: ok.", { bot }));
    const server = driver.server as { enabledSkills(cwd: string): Promise<string[]> };
    expect(await server.enabledSkills(workdir)).toEqual([]);
  }, 180_000);

  it("gives a Bot only OpenBot's tools, none of the account's connected apps", async () => {
    const turn = await runTurn(
      driver,
      input("Reply only: ok.", {
        bot: { id: "bot_live_tools", name: "tools" } as TurnInput["bot"],
        mcpServers: [{ name: "openbot", command: process.execPath, args: [stubPath] }],
      }),
    );
    await new Promise((r) => setTimeout(r, 6_000));
    const server = driver.server as {
      listMcpServerStatus(threadId: string): Promise<{ data?: Array<{ name: string }> }>;
    };
    const status = await server.listMcpServerStatus(turn.sessionId!);
    expect((status.data ?? []).map((s) => s.name).sort(), "MCP servers in the Bot thread").toEqual([
      "openbot",
    ]);
  }, 120_000);

  it("resumes a conversation after the app-server restarts", async () => {
    const first = await runTurn(driver, input("Remember the word MANGO. Reply only: ok."));
    expect(first.sessionId).toBeTruthy();
    const fresh = new CodexDriver({ appServer: undefined });
    // A driver with a brand-new process, given the stored session id, must resume it.
    const second = await runTurn(
      fresh,
      input("What word did I ask you to remember? One word.", { sessionId: first.sessionId }),
    );
    expect(second.text.toUpperCase()).toContain("MANGO");
  }, 180_000);
});
