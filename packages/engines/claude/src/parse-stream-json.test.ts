import { describe, expect, it } from "vitest";
import { createClaudeParseState, handleClaudeLine } from "./parse-stream-json.js";

const delta = (text: string) => ({
  type: "stream_event",
  event: { type: "content_block_delta", delta: { type: "text_delta", text } },
});
const assistant = (text: string) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});

describe("handleClaudeLine", () => {
  it("does not repeat text that already streamed as partial deltas", () => {
    const state = createClaudeParseState();
    const emitted: string[] = [];
    const hooks = {
      emit: (e: { type: string; text?: string }) => {
        if (e.type === "text_delta") emitted.push(e.text ?? "");
      },
    };

    handleClaudeLine(delta("Hello "), state, hooks);
    handleClaudeLine(delta("there"), state, hooks);
    handleClaudeLine(assistant("Hello there"), state, hooks);
    // A later message in the same turn without partials still counts.
    handleClaudeLine(assistant(" Done."), state, hooks);

    expect(state.text).toBe("Hello there Done.");
    expect(emitted.join("")).toBe("Hello there Done.");
  });

  it("reports tool calls and their results", () => {
    const state = createClaudeParseState();
    const events: Array<Record<string, unknown>> = [];
    const hooks = { emit: (e: Record<string, unknown>) => events.push(e) };

    handleClaudeLine(
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "tu_1", name: "mcp__openbot__list_bots", input: {} }],
        },
      },
      state,
      hooks as never,
    );
    handleClaudeLine(
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: "[]" }] },
      },
      state,
      hooks as never,
    );

    expect(events).toEqual([
      { type: "tool_started", toolName: "mcp__openbot__list_bots", input: {}, toolUseId: "tu_1" },
      { type: "tool_completed", toolUseId: "tu_1", output: "[]", isError: false },
    ]);
  });

  it("explains a turn that ended on the step limit instead of saying 'turn failed'", () => {
    const state = createClaudeParseState();
    handleClaudeLine(
      { type: "result", subtype: "error_max_turns", is_error: true, num_turns: 51 },
      state,
      { emit: () => undefined },
    );
    expect(state.isError).toBe(true);
    expect(state.errorMessage).toMatch(/step limit.*51 steps.*continue/);
  });

  it("uses the CLI's own error list when it gives one", () => {
    const state = createClaudeParseState();
    handleClaudeLine(
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["disk full"] },
      state,
      { emit: () => undefined },
    );
    expect(state.errorMessage).toBe("disk full");
  });

  it("ends the turn with the CLI's last stderr line when the process exits mid-turn", () => {
    const state = createClaudeParseState();
    handleClaudeLine(
      {
        type: "openbot_process_exit",
        code: 1,
        stderr: "starting\nError: MCP server openbot failed to start",
      },
      state,
      { emit: () => undefined },
    );
    expect(state).toMatchObject({
      turnComplete: true,
      isError: true,
      errorMessage:
        "Claude Code stopped unexpectedly (exit code 1): Error: MCP server openbot failed to start",
    });

    // After a normal result, a later exit changes nothing.
    const done = createClaudeParseState();
    handleClaudeLine({ type: "result", is_error: false, usage: {} }, done, {
      emit: () => undefined,
    });
    handleClaudeLine({ type: "openbot_process_exit", code: 0 }, done, { emit: () => undefined });
    expect(done.isError).toBe(false);
  });
});
