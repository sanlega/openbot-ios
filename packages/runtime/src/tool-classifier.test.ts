import { describe, expect, it } from "vitest";
import { classifyToolCall, isReadOnlyShell } from "./tool-classifier.js";

describe("isReadOnlyShell", () => {
  it.each([
    "ls -la ~/.openbot; ls -la ~/.openbot/workspace",
    'grep -rl "ideas" ~/.openbot 2>/dev/null | head -30',
    "git status && git log --oneline -5",
    "find . -name '*.md' | wc -l",
    "cat notes.md | sort | uniq",
  ])("allows %s", (command) => {
    expect(isReadOnlyShell(command)).toBe(true);
  });

  it.each([
    "rm -rf build",
    "echo hi > notes.md",
    "cat a | tee b",
    "ls $(whoami)",
    "find . -name x -delete",
    "sed -i s/a/b/ f",
    "git push",
    "curl https://example.com",
    "npm install",
  ])("does not allow %s", (command) => {
    expect(isReadOnlyShell(command)).toBe(false);
  });
});

describe("classifyToolCall", () => {
  it("marks reads read-only and file edits in the workspace as in-workspace", () => {
    expect(classifyToolCall("Read", { file_path: "/etc/hosts" }).readOnly).toBe(true);
    expect(classifyToolCall("Write", { file_path: "notes/a.md" }, "/ws").inWorkspace).toBe(true);
    expect(classifyToolCall("Write", { file_path: "/ws/notes/a.md" }, "/ws").inWorkspace).toBe(
      true,
    );
    expect(classifyToolCall("Edit", { file_path: "/ws/../etc/x" }, "/ws").inWorkspace).toBe(false);
    expect(classifyToolCall("Bash", { command: "ls" }).readOnly).toBe(true);
    expect(classifyToolCall("exec_command", { command: ["bash", "-lc", "ls -la"] }).readOnly).toBe(
      true,
    );
  });
});
