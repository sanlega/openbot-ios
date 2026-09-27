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
