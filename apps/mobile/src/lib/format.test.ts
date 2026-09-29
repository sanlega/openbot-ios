import type { Approval } from "@openbot/contracts";
import { describe, expect, it } from "vitest";
import {
  approvalAction,
  approvalTarget,
  botHue,
  botNamer,
  botStatus,
  initials,
  plainText,
  relativeTime,
} from "./format";

const approval = (summary: string, detail: string): Approval => ({
  id: "apr_1",
  kind: "tool",
  botId: "bot_writer",
  summary,
  detail,
  status: "pending",
  resolution: null as unknown as Approval["resolution"],
  expiresAt: "2026-09-29T12:00:00.000Z",
  createdAt: "2026-09-29T11:00:00.000Z",
});

describe("mobile format helpers", () => {
  it("names bots and never shows raw ids", () => {
    const namer = botNamer([
      { id: "bot_writer", name: "Writer" } as never,
      { id: "bot_chief", name: "Chief" } as never,
    ]);
    expect(namer.name("bot_writer")).toBe("Writer");
    expect(namer.name("bot_gone")).toBe("A removed bot");
    expect(namer.humanize("Bash requested by bot_chief")).toBe("Bash requested by Chief");
  });

  it("describes approvals in plain words", () => {
    const shell = approval("Permission prompt: Bash", '{"command":"ls -la"}\n\nOutside workspace');
    expect(approvalAction(shell, (text) => text)).toBe("Run a command");
    expect(approvalTarget(shell)).toBe("ls -la");
    const edit = approval("Write requested by bot_writer", '{"file_path":"/tmp/notes.md"}');
    expect(approvalAction(edit, (text) => text)).toBe("Write notes.md");
  });

  it("derives a bot status with the user's attention first", () => {
    expect(botStatus({ status: "running" }, true)).toBe("needs-you");
    expect(botStatus({ status: "queued" }, false)).toBe("working");
    expect(botStatus({ status: "failed" }, false)).toBe("failed");
    expect(botStatus(undefined, false)).toBe("idle");
  });

  it("formats previews, initials, hues, and relative times", () => {
    expect(plainText("**Done:** see `notes.md`\n- item")).toBe("Done: see notes.md item");
    expect(initials("Research  helper bot")).toBe("RH");
    expect(initials("")).toBe("?");
    expect(botHue({ id: "bot_writer" })).toBe(botHue({ id: "bot_writer" }));
    const now = new Date("2026-09-29T12:00:00.000Z");
    expect(relativeTime("2026-09-29T11:59:30.000Z", now)).toBe("Just now");
    expect(relativeTime("2026-09-29T11:15:00.000Z", now)).toBe("45m ago");
  });
});
