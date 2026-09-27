import { useState, type FormEvent } from "react";
import type { Approval } from "@openbot/contracts";
import type { ThreadPanel } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";
import { ApprovalCard } from "../cards/ApprovalCard.js";
import { ComputerPanel } from "../computer/ComputerPanel.js";
import { DigestMessage } from "../digest/DigestMessage.js";
import { BotWhyPanel } from "../profile/BotWhyPanel.js";
import { MessageBubble } from "../roster/BotList.js";
import { RouteChip } from "./RouteChip.js";

interface ThreadViewProps {
  onBack?: () => void;
}

export function ThreadViewPanel({ onBack }: ThreadViewProps) {
  const {
    selectedThreadId,
    threads,
    bots,
    messagesForThread,
    pendingApprovals,
    sendMessage,
    resolveApproval,
    routeForBot,
  } = useOpenBot();
  const [draft, setDraft] = useState("");
  const [panel, setPanel] = useState<ThreadPanel>("chat");

  const thread = threads.find((t) => t.id === selectedThreadId);
  const bot = thread ? bots.find((b) => b.id === thread.botId) : undefined;
  const messages = thread ? messagesForThread(thread.id) : [];
  const route = thread ? routeForBot(thread.botId) : undefined;
  const threadApprovals = pendingApprovals.filter((a) => a.botId === thread?.botId);

  if (!thread || !bot) {
    return <div className="empty-state">Select a bot to start chatting</div>;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendMessage(text);
  };

  const showComputer = bot.computer !== "none";

  return (
    <>
      <header className="thread-header">
        {onBack ? (
          <button type="button" className="icon-button" onClick={onBack} aria-label="Back">
            ←
          </button>
        ) : null}
        <span className="bot-avatar" style={{ width: 36, height: 36, fontSize: "1rem" }}>
          {bot.avatar ?? bot.name.slice(0, 1)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="bot-name">{thread.title}</div>
          <Participants participantIds={thread.participantIds} bots={bots} />
        </div>
        {route ? <RouteChip route={route} /> : null}
      </header>

      <div className="thread-subnav">
        <button
          type="button"
          className="nav-tab"
          data-active={panel === "chat"}
          onClick={() => setPanel("chat")}
        >
          Chat
        </button>
        {showComputer ? (
          <button
            type="button"
            className="nav-tab"
            data-active={panel === "computer"}
            onClick={() => setPanel("computer")}
          >
            Computer
          </button>
        ) : null}
        <button
          type="button"
          className="nav-tab"
          data-active={panel === "profile"}
          onClick={() => setPanel("profile")}
        >
          Profile
        </button>
      </div>

      {panel === "chat" ? (
        <>
          <div className="thread-messages" data-testid="thread-messages">
            {threadApprovals.map((a: Approval) => (
              <ApprovalCard key={a.id} approval={a} onResolve={(r) => resolveApproval(a.id, r)} />
            ))}
            {messages.map((m) =>
              m.text === "__digest__" ? (
                <div key={m.id} className="message-row" data-author="bot">
                  <DigestMessage postedAt={m.createdAt} />
                  <span className="message-meta">{bot.name}</span>
                </div>
              ) : (
                <MessageBubble key={m.id} message={m} bot={bot} />
              ),
            )}
          </div>
          <form className="composer" onSubmit={(e) => void onSubmit(e)}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Message ${bot.name}…`}
              aria-label="Message"
            />
            <button type="submit" disabled={!draft.trim()}>
              Send
            </button>
          </form>
        </>
      ) : null}

      {panel === "computer" && showComputer ? (
        <div className="thread-messages">
          <ComputerPanel botId={bot.id} />
        </div>
      ) : null}

      {panel === "profile" ? (
        <div className="thread-messages">
          <BotWhyPanel botId={bot.id} />
        </div>
      ) : null}
    </>
  );
}

function Participants({
  participantIds,
  bots,
}: {
  participantIds: string[];
  bots: { id: string; name: string }[];
}) {
  return (
    <div className="participants" aria-label="Participants">
      {participantIds.map((id) => {
        const label = id === "user" ? "You" : (bots.find((b) => b.id === id)?.name ?? id);
        return (
          <span key={id} className="participant-chip">
            {label}
          </span>
        );
      })}
    </div>
  );
}
