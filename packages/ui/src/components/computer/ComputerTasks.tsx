import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Ban,
  Check,
  CornerDownLeft,
  Hand,
  Keyboard,
  Loader2,
  MousePointerClick,
  MoveVertical,
  Square,
  TextCursorInput,
  TriangleAlert,
} from "lucide-react";
import { useOpenBot } from "../../state/context.js";
import { clockTime } from "../common/time.js";

interface TaskStep {
  step: number;
  op?: string;
  target?: string;
  outcome: string;
  reason?: string;
  at: string;
}

interface ComputerTask {
  id: string;
  goal: string;
  status: string;
  steps: number;
  createdAt?: string;
  timeline?: TaskStep[];
  needsText?: string;
  summary?: string;
  page?: { url?: string; title?: string };
}

const ACTIVE = new Set(["running", "needs_input"]);

const STATUS: Record<string, { label: string; pill: string }> = {
  running: { label: "Working", pill: "pill-accent" },
  needs_input: { label: "Needs text", pill: "pill-warning" },
  completed: { label: "Done", pill: "pill-success" },
  escalated: { label: "Stopped", pill: "pill-warning" },
  takeover: { label: "Needs you", pill: "pill-warning" },
  failed: { label: "Failed", pill: "pill-danger" },
  cancelled: { label: "Cancelled", pill: "pill-muted" },
};

/**
 * The bot's computer tasks: what Jev did step by step, what text it is waiting
 * for (you can answer instead of the bot), and a way to stop it.
 */
export function ComputerTasks({ botId }: { botId: string }) {
  const { transport } = useOpenBot();
  const [tasks, setTasks] = useState<ComputerTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await transport.get<{ tasks: ComputerTask[] }>(
        `/api/computer/tasks?botId=${botId}`,
      );
      setTasks([...res.tasks].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load computer tasks");
      setTasks([]);
    }
  }, [transport, botId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Follow live tasks until they finish.
  const anyActive = tasks?.some((t) => ACTIVE.has(t.status)) ?? false;
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => void load(), 1500);
    return () => clearInterval(timer);
  }, [anyActive, load]);

  const act = async (taskId: string, path: "cancel" | "steer", body?: unknown) => {
    try {
      await transport.post(`/api/computer/tasks/${taskId}/${path}`, body);
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The task didn't respond");
    }
  };

  return (
    <section className="settings-card" data-testid="computer-tasks">
      <div className="settings-card-header">
        <h3>Tasks</h3>
        <p>
          When this bot uses its computer, Jev picks each step and OpenBot checks it before it runs.
          Risky steps ask you first.
        </p>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {tasks === null ? null : tasks.length === 0 ? (
        <p className="field-help">
          No computer tasks yet. Ask the bot to do something on its computer.
        </p>
      ) : (
        <div className="ctask-list">
          {tasks.slice(0, 10).map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onCancel={() => void act(task.id, "cancel")}
              onText={(text) => void act(task.id, "steer", { text })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TaskCard({
  task,
  onCancel,
  onText,
}: {
  task: ComputerTask;
  onCancel: () => void;
  onText: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const status = STATUS[task.status] ?? { label: task.status, pill: "pill-muted" };
  const active = ACTIVE.has(task.status);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onText(text);
    setText("");
  };

  return (
    <article className="ctask" data-status={task.status} data-testid={`ctask-${task.id}`}>
      <header className="ctask-head">
        <span className="ctask-goal">{task.goal}</span>
        <span className={`pill ${status.pill}`}>
          {task.status === "running" ? <Loader2 size={11} className="spin" /> : null}
          {status.label}
        </span>
        {active ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            <Square size={11} fill="currentColor" /> Stop
          </button>
        ) : null}
      </header>
      {task.page?.title ? <p className="ctask-page">On “{task.page.title}”</p> : null}
      {task.timeline?.length ? (
        <ol className="ctask-steps">
          {task.timeline.map((step) => (
            <li key={step.step} data-outcome={step.outcome}>
              <span className="ctask-icon" aria-hidden>
                {stepIcon(step)}
              </span>
              <span className="ctask-text">
                {describe(step)}
                {step.reason && step.outcome !== "executed" ? (
                  <span className="ctask-reason"> · {step.reason}</span>
                ) : null}
              </span>
              <time className="ctask-time">{clockTime(step.at)}</time>
            </li>
          ))}
        </ol>
      ) : null}
      {task.needsText ? (
        <form className="ctask-input" onSubmit={submit}>
          <label className="field">
            <span className="field-label">The bot needs text for “{task.needsText}”</span>
            <span className="field-help">
              The bot usually answers this itself. You can type it here instead.
            </span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label={`Text for ${task.needsText}`}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim()}>
            Send
          </button>
        </form>
      ) : null}
      {!active && task.summary && task.status !== "completed" ? (
        <p className="ctask-summary">{task.summary}</p>
      ) : null}
    </article>
  );
}

function describe(step: TaskStep): string {
  const target = step.target ? ` “${step.target}”` : "";
  switch (step.op) {
    case "click":
      return `Clicked${target}`;
    case "type":
      return `Typed into${target}`;
    case "select":
      return `Picked an option in${target}`;
    case "key":
      return "Pressed a key";
    case "scroll":
      return "Scrolled";
    case "wait":
      return "Waited for the page";
    case "done":
      return "Finished";
    case "blocked":
      return "Handed over to you";
    default:
      return step.outcome === "cancelled" ? "Stopped" : "Stopped";
  }
}

function stepIcon(step: TaskStep): ReactNode {
  if (step.outcome === "denied") return <Ban size={12} />;
  if (step.outcome === "escalated" || step.outcome === "blocked")
    return <TriangleAlert size={12} />;
  if (step.outcome === "takeover") return <Hand size={12} />;
  switch (step.op) {
    case "click":
    case "select":
      return <MousePointerClick size={12} />;
    case "type":
      return <TextCursorInput size={12} />;
    case "key":
      return step.target ? <Keyboard size={12} /> : <CornerDownLeft size={12} />;
    case "scroll":
      return <MoveVertical size={12} />;
    case "done":
      return <Check size={12} />;
    default:
      return <Loader2 size={12} />;
  }
}
