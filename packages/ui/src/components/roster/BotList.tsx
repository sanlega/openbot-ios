import type { Bot, Message } from "@openbot/contracts";
import type { ThreadView } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";

interface BotListProps {
  onSelectActivity?: () => void;
}

export function BotList({ onSelectActivity }: BotListProps) {
  const { bots, threads, selectedThreadId, selectThread, pendingApprovals } = useOpenBot();

  const botForThread = (thread: ThreadView): Bot | undefined =>
    bots.find((b) => b.id === thread.botId);

  return (
    <div className="bot-list" data-testid="bot-list">
      {threads.map((thread) => {
        const bot = botForThread(thread);
        if (!bot || bot.archivedAt) return null;
        return (
          <button
            key={thread.id}
            type="button"
            className="bot-item"
            data-active={selectedThreadId === thread.id}
            onClick={() => selectThread(thread.id)}
          >
            <span className="bot-avatar" aria-hidden>
              {bot.avatar ?? bot.name.slice(0, 1)}
            </span>
            <span className="bot-meta">
              <span className="bot-name-row">
                <span className="bot-name">{thread.title}</span>
                {bot.isChiefOfStaff ? <span className="badge badge-cos">CoS</span> : null}
                {bot.createdBy !== "user" ? <span className="badge">CoS spawn</span> : null}
              </span>
              <span className="bot-preview">{thread.lastMessagePreview ?? bot.description}</span>
            </span>
          </button>
        );
      })}
      {pendingApprovals.length > 0 ? (
        <button type="button" className="bot-item" onClick={onSelectActivity}>
          <span className="bot-avatar">⚠️</span>
          <span className="bot-meta">
            <span className="bot-name">{pendingApprovals.length} pending approval(s)</span>
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function MessageBubble({ message, bot }: { message: Message; bot?: Bot }) {
  const author =
    message.author.type === "user"
      ? "You"
      : message.author.type === "routine"
        ? "Routine"
        : (bot?.name ?? "Bot");

  return (
    <div className="message-row" data-author={message.author.type} data-testid={`msg-${message.id}`}>
      <div className="message-bubble">
        {message.proactive && message.kind ? (
          <span className="badge" style={{ marginBottom: 6, display: "inline-block" }}>
            {message.kind}
          </span>
        ) : null}
        {message.delivery === "held" ? (
          <span className="badge badge-held" style={{ marginBottom: 6, display: "inline-block" }}>
            Not delivered
          </span>
        ) : null}
        <div>{message.text}</div>
        {message.options?.length ? (
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {message.options.map((opt) => (
              <button key={opt} type="button" className="icon-button" style={{ width: "auto", padding: "4px 10px" }}>
                {opt}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <span className="message-meta">{author}</span>
    </div>
  );
}
