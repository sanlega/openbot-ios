import { describe, expect, it } from "vitest";
import { createClaudeParseState, handleClaudeLine } from "@openbot/engines-claude";
import { loadFixture, recvLines } from "@openbot/engines-common";

describe("ClaudeDriver golden parser", () => {
  it("replays claude-mcp-config fixture init wiring", async () => {
    const lines = recvLines(
      await loadFixture("claude/claude-mcp-config-and-permission-prompt-tool.jsonl"),
    );
    const init = lines.find(
      (l: Record<string, unknown>) => l.type === "system" && l.subtype === "init",
    ) as { mcp_servers?: Array<{ name?: string; status?: string }>; tools?: string[] } | undefined;
    expect(init?.mcp_servers?.some((s) => s.name === "openbot" && s.status === "connected")).toBe(
      true,
    );
    expect(init?.tools?.some((t) => t.includes("send_message"))).toBe(true);
    expect(init?.tools?.some((t) => t.includes("permission_prompt"))).toBe(false);
  });

  it("handles stream_event partial messages", () => {
    const state = createClaudeParseState();
    const deltas: string[] = [];
    handleClaudeLine(
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } },
      },
      state,
      { emit: (e) => e.type === "text_delta" && deltas.push(e.text) },
    );
    expect(deltas).toEqual(["Hi"]);
  });
});
