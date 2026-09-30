import { useState, type FormEvent } from "react";
import type { Bot } from "@openbot/contracts";
import type { ThreadView } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";
import { BotAvatar, type BotStatus } from "../common/BotAvatar.js";
import { shortTime } from "../common/time.js";
import { plainText } from "../activity/format.js";

interface BotListProps {
  creating?: boolean;
  onCreatingChange?: (creating: boolean) => void;
  /** Called after a Bot is picked (e.g. to show the thread on phones). */
  onSelect?: () => void;
  /** Only mark the open thread when the chat is what's on screen. */
  highlightSelection?: boolean;
}

export function BotList({
  creating = false,
  onCreatingChange,
  onSelect,
  highlightSelection = true,
}: BotListProps) {
  const { bots, threads, selectedThreadId, selectThread, pendingApprovals, state } = useOpenBot();

  const statusOf = (botId: string): BotStatus => {
    if (pendingApprovals.some((a) => a.botId === botId)) return "needs-you";
    if ([...state.inputs.values()].some((i) => i.botId === botId && i.status === "pending")) {
      return "needs-you";
    }
    if ([...state.turns.values()].some((t) => t.botId === botId && t.status === "running")) {
      return "working";
    }
    return "idle";
  };

  const rows = threads
    .map((thread) => ({ thread, bot: bots.find((b) => b.id === thread.botId) }))
    .filter((r): r is { thread: ThreadView; bot: Bot } => Boolean(r.bot && !r.bot.archivedAt));
  const chief = rows.filter((r) => r.bot.isChiefOfStaff);
  const team = rows
    .filter((r) => !r.bot.isChiefOfStaff)
    .sort((a, b) => (b.thread.lastMessageAt ?? "").localeCompare(a.thread.lastMessageAt ?? ""));

  const renderRow = ({ thread, bot }: { thread: ThreadView; bot: Bot }) => {
    const status = statusOf(bot.id);
    const active = highlightSelection && selectedThreadId === thread.id;
    return (
      <button
        key={thread.id}
        type="button"
        className="bot-item"
        data-active={active}
        aria-current={active ? "page" : undefined}
        data-status={status}
        onClick={() => {
          selectThread(thread.id);
          onSelect?.();
        }}
      >
        <BotAvatar bot={bot} size={32} status={status} />
        <span className="bot-meta">
          <span className="bot-name-row">
            <span className="bot-name">{thread.title || bot.name}</span>
            {status === "needs-you" ? (
              <span className="pill pill-warning">Needs you</span>
            ) : thread.lastMessageAt ? (
              <span className="bot-time">{shortTime(thread.lastMessageAt)}</span>
            ) : null}
          </span>
          <span className="bot-preview">
            {status === "working"
              ? "Working…"
              : thread.lastMessagePreview
                ? `${thread.lastMessageAuthor === "user" ? "You: " : ""}${plainText(thread.lastMessagePreview)}`
                : (bot.label ?? bot.description)}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="bot-list" data-testid="bot-list">
      {creating ? <NewBotForm onDone={() => onCreatingChange?.(false)} /> : null}
      {chief.map(renderRow)}
      {team.length > 0 ? <div className="roster-section">Team</div> : null}
      {team.map(renderRow)}
      {rows.length === 0 && !creating ? (
        <div className="roster-empty">
          <p>No bots yet.</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onCreatingChange?.(true)}
          >
            Create a bot
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NewBotForm({ onDone }: { onDone: () => void }) {
  const { transport, refresh, selectThread } = useOpenBot();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await transport.post<{ thread: { id: string } }>("/api/bots", {
        name: name.trim(),
        description: description.trim(),
      });
      await refresh();
      selectThread(res.thread.id);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the bot");
      setBusy(false);
    }
  };

  return (
    <form
      className="new-bot-form"
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => e.key === "Escape" && onDone()}
    >
      <div className="new-bot-title">New bot</div>
      <input
        aria-label="Bot name"
        placeholder="Name, e.g. Researcher"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <textarea
        aria-label="Bot description"
        placeholder="What is it for? This becomes its standing instructions."
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {error ? <span className="form-error">{error}</span> : null}
      <div className="new-bot-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>
          Create
        </button>
      </div>
    </form>
  );
}
