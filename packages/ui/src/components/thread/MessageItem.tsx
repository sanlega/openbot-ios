import type { Bot, Message } from "@openbot/contracts";
import { ArrowRightLeft, BellOff, Info } from "lucide-react";
import { BotAvatar } from "../common/BotAvatar.js";
import { clockTime } from "../common/time.js";
import { MessageText } from "./MessageText.js";

interface MessageItemProps {
  message: Message;
  /** The thread's own Bot. */
  bot: Bot;
  /** Every Bot, to name a sender from another thread (handoffs). */
  bots: Bot[];
  /** Same author as the previous message, a few minutes apart: no header. */
  grouped: boolean;
  onQuickReply?: (text: string) => void;
}

const KIND_LABEL: Record<NonNullable<Message["kind"]>, string> = {
  result: "Result",
  decision: "Decision needed",
  blocker: "Blocked",
};

export function MessageItem({ message, bot, bots, grouped, onQuickReply }: MessageItemProps) {
  const time = clockTime(message.createdAt);

  if (message.author.type === "user") {
    return (
      <div className="msg msg-user" data-author="user" data-testid={`msg-${message.id}`}>
        <div className="msg-bubble">
          <MessageText text={message.text} markdown={false} />
        </div>
        <span className="msg-time" title={new Date(message.createdAt).toLocaleString()}>
          {time}
        </span>
      </div>
    );
  }

  if (message.author.type === "system") {
    // Notes from OpenBot itself (engine switched, etc.): centered, not a bubble.
    return (
      <div className="msg msg-system" data-author="system" data-testid={`msg-${message.id}`}>
        <Info size={13} aria-hidden />
        <span>{message.text}</span>
        <span className="msg-time">{time}</span>
      </div>
    );
  }

  const sender =
    message.author.type === "bot" && message.author.id && message.author.id !== bot.id
      ? bots.find((b) => b.id === message.author.id)
      : undefined;

  if (sender) {
    // A task another Bot sent to this one.
    return (
      <div className="msg msg-handoff" data-author="bot" data-testid={`msg-${message.id}`}>
        <div className="handoff-header">
          <ArrowRightLeft size={13} aria-hidden />
          <span>
            Task from <strong>{sender.name}</strong>
          </span>
          <span className="msg-time">{time}</span>
        </div>
        <div className="handoff-body">
          <MessageText text={message.text} markdown />
        </div>
      </div>
    );
  }

  const author = message.author.type === "routine" ? "Routine" : bot.name;

  return (
    <div
      className="msg msg-bot"
      data-author={message.author.type}
      data-grouped={grouped}
      data-testid={`msg-${message.id}`}
    >
      <div className="msg-gutter">{grouped ? null : <BotAvatar bot={bot} size={28} />}</div>
      <div className="msg-content">
        {grouped ? null : (
          <div className="msg-header">
            <span className="msg-author">{author}</span>
            <span className="msg-time" title={new Date(message.createdAt).toLocaleString()}>
              {time}
            </span>
          </div>
        )}
        {(message.proactive && message.kind) || message.delivery === "held" ? (
          <div className="msg-tags">
            {message.proactive && message.kind ? (
              <span className="pill pill-kind" data-kind={message.kind}>
                {KIND_LABEL[message.kind]}
              </span>
            ) : null}
            {message.delivery === "held" ? (
              <span
                className="pill pill-muted"
                title="Held by the notify gate; it goes to the digest"
              >
                <BellOff size={11} aria-hidden /> Not delivered
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="msg-body">
          <MessageText text={message.text} markdown />
        </div>
        {message.options?.length ? (
          <div className="quick-replies">
            {message.options.map((opt) => (
              <button
                key={opt}
                type="button"
                className="chip"
                onClick={() => onQuickReply?.(opt)}
                disabled={!onQuickReply}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
