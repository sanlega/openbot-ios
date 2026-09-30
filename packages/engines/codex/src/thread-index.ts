import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TurnInput } from "@openbot/contracts";
import { sandboxFor } from "./thread-params.js";

/**
 * What a Codex thread was created with. Codex fixes a thread's MCP servers, sandbox and
 * instructions when it is created: resuming (even in a new process) with different ones changes
 * nothing. So a stored thread is only reused if it was created with what the Bot needs now.
 */
export interface ThreadRecord {
  /** The MCP servers (by name, command, args) and sandbox the thread was created with. */
  signature: string;
  /** The Bot instructions the thread currently follows. */
  prompt: string;
}

/** Bumped whenever how OpenBot creates threads changes, so older threads are not reused. */
const SCHEMA = "v3";

export function signatureOf(input: TurnInput): string {
  const servers = (input.mcpServers ?? [])
    .map((s) => ({ name: s.name, command: s.command, args: s.args ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify({ schema: SCHEMA, sandbox: sandboxFor(input.permission), servers });
}

const MAX_ENTRIES = 500;

/** Remembers each thread's record; persisted next to the private Codex home when given a file. */
export class ThreadIndex {
  private data: Record<string, ThreadRecord> = {};

  constructor(private readonly file?: string) {
    if (!file) return;
    try {
      this.data = JSON.parse(readFileSync(file, "utf8")) as Record<string, ThreadRecord>;
    } catch {
      this.data = {};
    }
  }

  get(threadId: string): ThreadRecord | undefined {
    return this.data[threadId];
  }

  set(threadId: string, record: ThreadRecord): void {
    this.data[threadId] = record;
    const ids = Object.keys(this.data);
    for (const old of ids.slice(0, Math.max(0, ids.length - MAX_ENTRIES))) delete this.data[old];
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(temp, this.file);
    } catch {
      // The index is an optimization for reuse; failing to save only costs a fresh thread.
    }
  }
}
