import { describe, expect, it } from "vitest";
import { OPENBOT_TOOL_DEFINITIONS } from "./index.js";

describe("@openbot/mcp", () => {
  it("exports OpenBot tool definitions for MCP discovery", () => {
    expect(OPENBOT_TOOL_DEFINITIONS.map((t) => t.name)).toContain("message_user");
    expect(OPENBOT_TOOL_DEFINITIONS.map((t) => t.name)).toContain("create_bot");
  });
});
