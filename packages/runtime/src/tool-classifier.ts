import { isAbsolute, relative, resolve } from "node:path";
import type { BrokerRequest } from "./broker-types.js";

/** Engine tools that only read (files, the web, the Bot's own task list). */
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "NotebookRead",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  "ToolSearch",
  "BashOutput",
  "ExitPlanMode",
]);

/** Engine tools that write one file, named by `file_path`/`notebook_path`/`path`. */
const FILE_EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Other tools (e.g. connectors' MCP tools) named for reading. */
const READ_ONLY_NAME_RE = /^(read|get|list|search|observe|screenshot|status)/i;

const SHELL_TOOLS = new Set(["Bash", "shell", "exec_command", "local_shell"]);

/** Commands that only read, whatever their arguments (apart from the checks below). */
const READ_ONLY_COMMANDS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "egrep",
  "rg",
  "pwd",
  "echo",
  "which",
  "file",
  "stat",
  "du",
  "df",
  "date",
  "whoami",
  "uname",
  "tree",
  "sort",
  "uniq",
  "cut",
  "tr",
  "diff",
  "jq",
  "basename",
  "dirname",
  "realpath",
  "true",
]);

const READ_ONLY_GIT = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "ls-files",
  "rev-parse",
  "blame",
  "remote",
]);

/**
 * Describes an engine tool call for the permission broker, so the obvious cases
 * never reach the user: reads are read-only, and file edits say whether they
 * stay in the Bot's workspace. Everything else still goes through rules and Jev.
 */
export function classifyToolCall(
  toolName: string,
  input: unknown,
  workspaceDir?: string,
): Partial<BrokerRequest> {
  const args = (input ?? {}) as Record<string, unknown>;
  if (READ_ONLY_TOOLS.has(toolName)) {
    return { kind: "tool", action: toolName, readOnly: true, target: pathOf(args), args };
  }
  if (FILE_EDIT_TOOLS.has(toolName)) {
    const path = pathOf(args);
    return {
      kind: "tool",
      action: toolName,
      target: path,
      inWorkspace: path && workspaceDir ? isInside(path, workspaceDir) : false,
      args,
    };
  }
  if (SHELL_TOOLS.has(toolName)) {
    const command = commandOf(args);
    return {
      kind: "tool",
      action: toolName,
      target: command,
      readOnly: command ? isReadOnlyShell(command) : false,
      args,
    };
  }
  return {
    kind: "tool",
    action: toolName,
    target: pathOf(args),
    readOnly: READ_ONLY_NAME_RE.test(toolName),
    args,
  };
}

function pathOf(args: Record<string, unknown>): string | undefined {
  for (const key of ["file_path", "notebook_path", "path", "url", "target"]) {
    if (typeof args[key] === "string") return args[key];
  }
  return undefined;
}

function commandOf(args: Record<string, unknown>): string | undefined {
  const command = args.command ?? args.cmd;
  if (typeof command === "string") return command;
  if (Array.isArray(command) && command.every((c) => typeof c === "string")) {
    // Codex sends argv; `bash -lc "<script>"` wraps the real command.
    const argv = command as string[];
    if (argv.length === 3 && /(^|\/)(ba|z)?sh$/.test(argv[0]!) && argv[1] === "-lc") {
      return argv[2];
    }
    return argv.join(" ");
  }
  return undefined;
}

function isInside(path: string, dir: string): boolean {
  const full = isAbsolute(path) ? resolve(path) : resolve(dir, path);
  const rel = relative(resolve(dir), full);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * True for a pipeline/list of read-only commands. Anything that could write or
 * run arbitrary code (redirects to files, command substitution, `find -exec`,
 * `sed -i`, unknown programs) is not read-only.
 */
export function isReadOnlyShell(command: string): boolean {
  // Discarding output is harmless; any other redirect writes a file.
  const cleaned = command.replace(/\d?>\s*\/dev\/null/g, "").replace(/2>&1/g, "");
  if (/[<>`]|\$\(/.test(cleaned)) return false;
  const segments = cleaned.split(/&&|\|\||;|\||\n/);
  return segments.every((segment) => {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return true;
    const [program, ...rest] = words;
    const name = program!.split("/").pop()!;
    if (name === "git") return rest.length > 0 && READ_ONLY_GIT.has(rest[0]!);
    if (name === "find")
      return !rest.some((w) => /^-(exec|execdir|ok|okdir|delete|fprint)/.test(w));
    if (name === "sed") return !rest.some((w) => /^-i/.test(w) || w === "--in-place");
    return READ_ONLY_COMMANDS.has(name);
  });
}
