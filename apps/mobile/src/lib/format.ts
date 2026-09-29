// Ported from packages/ui (components/common/time.ts, components/activity/format.ts,
// components/common/BotAvatar.tsx) so the phone and desktop word things the same
// way. Keep them in sync.
import type { Approval, Bot, Turn } from "@openbot/contracts";

/** "14:02" today, "Yesterday", weekday within a week, else "27 Sep". */
export function shortTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  if (d.getTime() >= startOfToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getTime() >= startOfToday - day) return "Yesterday";
  if (d.getTime() >= startOfToday - 6 * day) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "Today", "Yesterday", or a full date, for day separators in a thread. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startOfToday) return "Today";
  if (d.getTime() >= startOfToday - 86_400_000) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

export function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** "Just now", "5m ago", "3h ago", then the short date/time used elsewhere. */
export function relativeTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const ms = now.getTime() - d.getTime();
  if (Number.isNaN(ms)) return "";
  if (ms < 60_000) return "Just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 6 * 3_600_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return shortTime(iso, now);
}

/** Full date and time for a tooltip. */
export function fullTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** Markdown → one line of plain text, for previews and titles. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** A Bot lookup that never shows raw ids: unknown ids read "A removed bot". */
export function botNamer(bots: Bot[]) {
  const byId = new Map(bots.map((b) => [b.id, b]));
  const name = (id?: string) => (id ? (byId.get(id)?.name ?? "A removed bot") : "OpenBot");
  /** Replaces any Bot id inside free text ("Bash requested by bot_01…") with its name. */
  const humanize = (text: string) =>
    text.replace(/\bbot_[A-Za-z0-9_]+/g, (id) => byId.get(id)?.name ?? "a bot");
  return { get: (id?: string) => (id ? byId.get(id) : undefined), name, humanize };
}

export const APPROVAL_TITLES: Record<Approval["kind"], string> = {
  tool: "Wants to take an action",
  computer_action: "Wants to use the computer",
  connector_action: "Wants to act in a connected app",
  chain_limit: "Asks whether to keep going",
  bot_request: "Needs your OK",
  local_computer: "Wants to use this computer",
  routine_live: "Wants to turn on a routine",
};

const SHELL_TOOLS = new Set(["Bash", "shell", "exec_command", "local_shell"]);
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "apply_patch"]);

/**
 * Reads what the broker wrote on a card: the summary names the tool
 * ("Permission prompt: Bash" or "Bash requested by bot_…"), the detail is the
 * tool input as JSON, then a blank line and why it asked.
 */
export function parseApproval(approval: Approval): {
  tool?: string;
  input?: Record<string, unknown>;
  reason?: string;
} {
  const tool =
    /^Permission prompt: (.+)$/.exec(approval.summary)?.[1] ??
    /^(\S+) requested by \S+$/.exec(approval.summary)?.[1];
  const [rawInput, ...rest] = approval.detail.split("\n\n");
  let input: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(rawInput ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      input = parsed as Record<string, unknown>;
    }
  } catch {
    input = undefined;
  }
  const reason = (input ? rest.join("\n\n") : approval.detail).trim() || undefined;
  return { tool: tool?.replace(/^mcp__\w+__/, ""), input, reason };
}

/** "Jev risk gate: band=confirm, external_side_effect=0.33" → a sentence. */
export function humanReason(reason: string): string {
  const risk = /Jev risk gate: band=(\w+), external_side_effect=([\d.]+)/.exec(reason);
  if (risk) {
    const pct = Math.round(Number(risk[2]) * 100);
    return `The risk check wasn't sure it was safe to do on its own (${pct}% chance of effects outside this computer).`;
  }
  return reason;
}

/** What an approval was about, in words: "Run a command", "Edit src/app.ts", … */
export function approvalAction(approval: Approval, humanize: (t: string) => string): string {
  const routine = /^Enable live runs for routine "(.+)"\?$/.exec(approval.summary);
  if (routine) return `Turn on live runs for “${routine[1]}”`;
  const { tool, input } = parseApproval(approval);
  const str = (key: string) => (typeof input?.[key] === "string" ? (input[key] as string) : "");
  if (str("description")) return humanize(str("description"));
  if (tool) {
    if (SHELL_TOOLS.has(tool)) return "Run a command";
    if (EDIT_TOOLS.has(tool)) {
      const file = str("file_path") || str("path");
      return file ? `${tool === "Write" ? "Write" : "Edit"} ${baseName(file)}` : "Edit files";
    }
    if (tool === "WebFetch" || tool === "WebSearch")
      return str("url") ? "Open a web page" : "Search the web";
    return `Use ${humanTool(tool)}`;
  }
  return humanize(approval.summary.replace(/\?$/, ""));
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function humanTool(tool: string): string {
  return tool.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** The command or target an approval acts on, when there is one (shown in mono). */
export function approvalTarget(approval: Approval): string | undefined {
  const { input } = parseApproval(approval);
  if (!input) return undefined;
  for (const key of ["command", "file_path", "url", "path", "query"]) {
    if (typeof input[key] === "string" && input[key]) return input[key] as string;
  }
  return undefined;
}

/** Who decided and how: "Approved by you", "Denied by you", "Expired", "Waiting for you". */
export function approvalOutcome(approval: Approval): {
  label: string;
  tone: "success" | "danger" | "muted" | "warning";
} {
  if (approval.status === "pending") return { label: "Waiting for you", tone: "warning" };
  if (approval.status === "expired" || approval.resolution === "expired") {
    return { label: "Expired", tone: "muted" };
  }
  if (approval.resolution === "allow") return { label: "Approved by you", tone: "success" };
  if (approval.resolution === "deny") return { label: "Denied by you", tone: "danger" };
  return { label: "Resolved", tone: "muted" };
}

/** A stable color per Bot, from its id, so each teammate is recognizable at a glance. */
const HUES = [228, 262, 292, 330, 12, 32, 152, 176, 198];

export function botHue(bot: Pick<Bot, "id">): number {
  let hash = 0;
  for (const ch of bot.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length]!;
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join("") || "?"
  );
}

export type BotStatus = "idle" | "working" | "needs-you" | "failed";

/** What a Bot is doing now, from its latest turn and whether something waits on the user. */
export function botStatus(latest: Pick<Turn, "status"> | undefined, needsYou: boolean): BotStatus {
  if (needsYou) return "needs-you";
  if (latest?.status === "running" || latest?.status === "queued") return "working";
  if (latest?.status === "failed") return "failed";
  return "idle";
}

export const STATUS_LABEL: Record<BotStatus, string> = {
  idle: "Ready",
  working: "Working",
  "needs-you": "Needs you",
  failed: "Failed",
};
