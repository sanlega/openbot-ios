import { describe, expect, it } from "vitest";
import { runEngineDriverConformance } from "@openbot/testkit";
import type { Bot, EngineEvent } from "@openbot/contracts";
import { FakeEngineDriver } from "./index.js";

runEngineDriverConformance("loop mode", () => new FakeEngineDriver({ mode: "loop" }));
runEngineDriverConformance("chatty mode", () => new FakeEngineDriver({ mode: "chatty" }));

const sampleBot: Bot = {
  id: "bot_1",
  slug: "assistant",
  name: "Assistant",
  description: "Test bot.",
  pinned: false,
  hidden: false,
  isChiefOfStaff: false,
  createdBy: "user",
  routing: { mode: "auto" },
  permissionPreset: "workspace_write",
  computer: "none",
  connectors: [],
  limits: {},
};

function turnInput(text = "hello") {
  return {
    bot: sampleBot,
    text,
    attachments: [],
    systemPrompt: "You are helpful.",
    cwd: "/workspace",
    addDirs: [],
    auth: { mode: "api_key" as const, env: {} },
    mcpServers: [],
    permission: "workspace_write" as const,
    allowTools: [],
    denyTools: [],
    model: "fake-default",
    limits: { maxSteps: 10 },
  };
}

describe("FakeEngineDriver", () => {
  it("loop mode replies once per turn with a canned reply", async () => {
    const driver = new FakeEngineDriver({ mode: "loop", replies: ["hi there"] });
    const events: EngineEvent[] = [];
    const handle = driver.startTurn(turnInput(), {
      emit: (e) => events.push(e),
      requestApproval: async () => "allow",
    });
    await handle.done;

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0]).toMatchObject({ type: "text_delta", text: "hi there" });
    expect(events.filter((e) => e.type === "tool_started")).toHaveLength(0);
  });

  it("cycles through multiple canned replies across turns", async () => {
    const driver = new FakeEngineDriver({ replies: ["first", "second"] });
    const run = async () => {
      const events: EngineEvent[] = [];
      const handle = driver.startTurn(turnInput(), {
        emit: (e) => events.push(e),
        requestApproval: async () => "allow",
      });
      await handle.done;
      return events.find((e) => e.type === "text_delta");
    };

    expect(await run()).toMatchObject({ text: "first" });
    expect(await run()).toMatchObject({ text: "second" });
    expect(await run()).toMatchObject({ text: "first" });
  });

  it("chatty mode emits message_user tool calls before replying", async () => {
    const driver = new FakeEngineDriver({ mode: "chatty", chattyMessageCount: 2 });
    const events: EngineEvent[] = [];
    const handle = driver.startTurn(turnInput(), {
      emit: (e) => events.push(e),
      requestApproval: async () => "allow",
    });
    await handle.done;

    const toolStarts = events.filter((e) => e.type === "tool_started");
    expect(toolStarts).toHaveLength(2);
    for (const e of toolStarts) {
      expect(e).toMatchObject({ toolName: "message_user" });
    }
    const lastTextIndex = events.findIndex((e) => e.type === "text_delta");
    const lastToolIndex = events.map((e) => e.type).lastIndexOf("tool_completed");
    expect(lastTextIndex).toBeGreaterThan(lastToolIndex);
  });

  it("interrupt() marks the turn result as an error", async () => {
    const driver = new FakeEngineDriver({ mode: "chatty", chattyMessageCount: 5 });
    const handle = driver.startTurn(turnInput(), {
      emit: () => {},
      requestApproval: async () => "allow",
    });
    await handle.interrupt();
    const result = await handle.done;
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toBe("interrupted");
  });

  it("steer() text is reflected in the eventual reply", async () => {
    const driver = new FakeEngineDriver({ mode: "loop", replies: ["base reply"] });
    const events: EngineEvent[] = [];
    const handle = driver.startTurn(turnInput(), {
      emit: (e) => events.push(e),
      requestApproval: async () => "allow",
    });
    await handle.steer("please be brief");
    await handle.done;

    const delta = events.find((e) => e.type === "text_delta");
    expect(delta).toMatchObject({ text: "base reply (steered: please be brief)" });
  });

  it("validateKey() rejects an empty key", async () => {
    const driver = new FakeEngineDriver();
    await expect(driver.validateKey("")).resolves.toMatchObject({ ok: false });
    await expect(driver.validateKey("sk-abc")).resolves.toMatchObject({ ok: true });
  });
});

describe("FakeEngineDriver scripted directives", () => {
  it("@approve asks permission and @tool calls the injected openbot MCP server", async () => {
    const { createServer } = await import("node:http");
    const calls: Array<{ url?: string; token?: string; body: string }> = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        calls.push({ url: req.url, token: req.headers["x-openbot-session"] as string, body });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ allowed: true }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    const approvals: string[] = [];
    const events: EngineEvent[] = [];
    const driver = new FakeEngineDriver();
    const handle = driver.startTurn(
      {
        ...turnInput(
          'plan\n@approve Write {"path":"a.md"}\n@tool message_user {"kind":"result","body":"hi"}',
        ),
        mcpServers: [
          {
            name: "openbot",
            command: "node",
            args: [],
            env: { OPENBOT_API_URL: `http://127.0.0.1:${port}`, OPENBOT_SESSION_TOKEN: "tok" },
          },
        ],
      },
      {
        emit: (e) => events.push(e),
        requestApproval: async (r) => {
          approvals.push(r.toolName);
          return "deny";
        },
      },
    );
    await handle.done;
    server.close();

    expect(approvals).toEqual(["Write"]);
    expect(calls).toEqual([
      {
        url: "/internal/tools/message_user",
        token: "tok",
        body: JSON.stringify({ kind: "result", body: "hi" }),
      },
    ]);
    expect(events.find((e) => e.type === "tool_started")).toMatchObject({
      toolName: "mcp__openbot__message_user",
    });
    expect(events.find((e) => e.type === "tool_completed")).toMatchObject({ isError: false });
  });

  it("@tool without an injected openbot server completes with an error", async () => {
    const events: EngineEvent[] = [];
    const handle = new FakeEngineDriver().startTurn(turnInput("@tool list_bots {}"), {
      emit: (e) => events.push(e),
      requestApproval: async () => "allow",
    });
    await handle.done;
    expect(events.find((e) => e.type === "tool_completed")).toMatchObject({ isError: true });
  });
});
