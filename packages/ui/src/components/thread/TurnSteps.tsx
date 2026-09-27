import type { ReactNode } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  ClipboardList,
  FileText,
  Hand,
  Globe,
  ListTodo,
  Loader2,
  MessageSquare,
  Pencil,
  Search,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import type { TurnActivity, TurnStep } from "../../state/reducer.js";

const OPENBOT_PREFIX = "mcp__openbot__";

/**
 * What the Bot did before answering, folded by default like a "thinking" block.
 * Engines do not expose their raw reasoning, so this shows the steps it took.
 */
export function TurnSteps({
  turn,
  waitingForUser = false,
}: {
  turn: TurnActivity;
  /** The running turn is parked on an approval card: say so instead of "Thinking…". */
  waitingForUser?: boolean;
}) {
  const running = turn.status === "running";
  const waiting = running && waitingForUser;
  if (!running && turn.steps.length === 0 && turn.status !== "failed") return null;

  const seconds = Math.max(
    1,
    Math.round(
      ((turn.endedAt ? Date.parse(turn.endedAt) : Date.now()) - Date.parse(turn.startedAt)) / 1000,
    ),
  );
  const steps = turn.steps.length;
  const current = turn.steps[steps - 1];
  const summary = waiting
    ? "Waiting for your approval"
    : running
      ? current
        ? stepTitle(current)
        : "Thinking…"
      : turn.status === "failed"
        ? `Couldn't finish · ${formatDuration(seconds)}`
        : `Worked for ${formatDuration(seconds)} · ${steps} ${steps === 1 ? "step" : "steps"}`;

  return (
    <details
      className="turn-steps"
      data-running={running}
      data-testid="turn-steps"
      open={turn.status === "failed"}
    >
      <summary>
        {waiting ? (
          <Hand size={14} className="turn-waiting" aria-hidden />
        ) : running ? (
          <Loader2 size={14} className="spin" aria-hidden />
        ) : turn.status === "failed" ? (
          <X size={14} className="turn-failed" aria-hidden />
        ) : (
          <Check size={14} aria-hidden />
        )}
        <span className={running && !waiting ? "shimmer" : undefined}>{summary}</span>
        {steps > 0 ? <ChevronRight size={14} className="turn-chevron" aria-hidden /> : null}
      </summary>
      {steps > 0 ? (
        <ol className="turn-step-list">
          {turn.steps.map((step) => (
            <li key={step.id} data-status={step.status}>
              <span className="turn-step-icon" aria-hidden>
                {step.status === "running" ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  iconFor(step.tool)
                )}
              </span>
              <span className="turn-step-tool">{toolName(step.tool)}</span>
              {detail(step) ? <span className="turn-step-detail">{detail(step)}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {!running && turn.status === "failed" ? (
        <p className="turn-error" role="alert">
          {failureDetail(turn.errorMessage)}
        </p>
      ) : null}
      {running && turn.text ? <p className="turn-draft">{turn.text}</p> : null}
    </details>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function failureDetail(message?: string): string {
  const detail = message?.trim();
  if (!detail) return "The engine stopped before it could reply. Check Activity for details.";
  const redacted = detail
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, "[redacted key]");
  return redacted.length > 300 ? `${redacted.slice(0, 297)}…` : redacted;
}

const TOOL_LABELS: Record<string, string> = {
  Read: "Read",
  Write: "Wrote",
  Edit: "Edited",
  MultiEdit: "Edited",
  Bash: "Ran",
  Grep: "Searched files",
  Glob: "Listed files",
  WebSearch: "Searched the web",
  WebFetch: "Opened",
  TodoWrite: "Updated its plan",
};

function toolName(tool: string): string {
  if (TOOL_LABELS[tool]) return TOOL_LABELS[tool];
  const bare = tool.startsWith(OPENBOT_PREFIX) ? tool.slice(OPENBOT_PREFIX.length) : tool;
  const name = bare.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function stepTitle(step: TurnStep): string {
  const d = detail(step);
  return d ? `${toolName(step.tool)} ${d}` : `${toolName(step.tool)}…`;
}

function iconFor(tool: string): ReactNode {
  const size = 13;
  if (tool === "Read") return <FileText size={size} />;
  if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) return <Pencil size={size} />;
  if (["Bash", "shell", "exec_command"].includes(tool)) return <Terminal size={size} />;
  if (["Grep", "Glob", "WebSearch", "ToolSearch"].includes(tool)) return <Search size={size} />;
  if (tool === "WebFetch") return <Globe size={size} />;
  if (tool === "TodoWrite") return <ListTodo size={size} />;
  if (tool.endsWith("send_message") || tool.endsWith("message_user")) {
    return <MessageSquare size={size} />;
  }
  if (tool.endsWith("ask_user")) return <ClipboardList size={size} />;
  if (tool.startsWith(OPENBOT_PREFIX)) return <Bot size={size} />;
  return <Wrench size={size} />;
}

/** The one argument that says what the step touched (file, command, URL, bot…). */
function detail(step: TurnStep): string | undefined {
  const input = (step.input ?? {}) as Record<string, unknown>;
  for (const key of [
    "file_path",
    "path",
    "command",
    "url",
    "query",
    "pattern",
    "bot",
    "name",
    "title",
  ]) {
    const value = input[key];
    if (typeof value === "string" && value) {
      const oneLine = value.replace(/\s+/g, " ");
      return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine;
    }
  }
  return undefined;
}
