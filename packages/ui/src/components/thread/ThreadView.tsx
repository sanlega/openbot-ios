import { Fragment, useLayoutEffect, useRef, useState } from "react";
import type { Approval, Bot, Message } from "@openbot/contracts";
import { ChevronLeft } from "lucide-react";
import type { ThreadPanel } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";
import { ApprovalCard } from "../cards/ApprovalCard.js";
import { BotAvatar, type BotStatus } from "../common/BotAvatar.js";
import { dayLabel, sameDay } from "../common/time.js";
import { ComputerPanel } from "../computer/ComputerPanel.js";
import { DigestMessage } from "../digest/DigestMessage.js";
import { BotConnectorsCard } from "../profile/BotConnectorsCard.js";
import { BotProfileEditor } from "../profile/BotProfileEditor.js";
import { BotWhyPanel } from "../profile/BotWhyPanel.js";
import { Composer } from "./Composer.js";
import { InputRequestCard } from "./InputRequestCard.js";
import { MessageItem } from "./MessageItem.js";
import { RouteChip } from "./RouteChip.js";
import { TurnSteps } from "./TurnSteps.js";

interface ThreadViewProps {
  onBack?: () => void;
}

const GROUP_WINDOW_MS = 5 * 60_000;

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
    state,
    transport,
  } = useOpenBot();
  const [panel, setPanel] = useState<ThreadPanel>("chat");

  const thread = threads.find((t) => t.id === selectedThreadId);
  const bot = thread ? bots.find((b) => b.id === thread.botId) : undefined;
  const messages = thread ? messagesForThread(thread.id) : [];
  const route = thread ? routeForBot(thread.botId) : undefined;
  const threadApprovals = pendingApprovals.filter((a) => a.botId === thread?.botId);
  const botTurns = [...state.turns.values()]
    .filter((t) => t.botId === thread?.botId)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const runningTurn = botTurns.find((t) => t.status === "running");
  const latestTurn = botTurns[botTurns.length - 1];
  const latestFailure = latestTurn?.status === "failed" ? latestTurn : undefined;
  const waiting =
    threadApprovals.length > 0 ||
    [...state.inputs.values()].some((i) => i.botId === bot?.id && i.status === "pending");
  const status: BotStatus = waiting ? "needs-you" : runningTurn ? "working" : "idle";
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastMessage = messages[messages.length - 1];

  // Like any chat: open at the newest message, and follow new ones unless the
  // user has scrolled up to read.
  const openedView = useRef("");
  useLayoutEffect(() => {
    const view = `${selectedThreadId}:${panel}`;
    if (openedView.current !== view) {
      openedView.current = view;
      stickToBottom.current = true;
    }
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [
    selectedThreadId,
    panel,
    messages.length,
    lastMessage?.text,
    threadApprovals.length,
    runningTurn?.steps.length,
    runningTurn?.text.length,
    latestFailure?.errorMessage,
  ]);

  if (!thread || !bot) {
    return (
      <div className="empty-state">
        <p className="empty-title">Pick a bot to start</p>
        <p className="empty-text">Your Chief of Staff is a good place to begin.</p>
      </div>
    );
  }

  const showComputer = bot.computer !== "none";
  const stop = () => void transport.post(`/api/threads/${thread.id}/stop`).catch(() => undefined);
  const subtitle =
    status === "working"
      ? "Working…"
      : status === "needs-you"
        ? "Waiting for you"
        : (bot.label ?? (bot.isChiefOfStaff ? "Chief of Staff" : oneLine(bot.description)));

  return (
    <div className="thread">
      <header className="thread-header">
        {onBack ? (
          <button type="button" className="icon-btn thread-back" onClick={onBack} aria-label="Back">
            <ChevronLeft size={18} />
          </button>
        ) : null}
        <button
          type="button"
          className="thread-identity"
          onClick={() => setPanel("profile")}
          title="Open profile"
        >
          <BotAvatar bot={bot} size={32} status={status} />
          <span className="thread-identity-text">
            <span className="thread-title">{thread.title || bot.name}</span>
            <span className="thread-subtitle" data-status={status}>
              {subtitle}
            </span>
          </span>
        </button>
        <div className="thread-header-actions">{route ? <RouteChip route={route} /> : null}</div>
      </header>

      <nav className="thread-tabs" aria-label="Bot views">
        <button
          type="button"
          className="tab"
          data-active={panel === "chat"}
          onClick={() => setPanel("chat")}
        >
          Chat
        </button>
        {showComputer ? (
          <button
            type="button"
            className="tab"
            data-active={panel === "computer"}
            onClick={() => setPanel("computer")}
          >
            Computer
          </button>
        ) : null}
        <button
          type="button"
          className="tab"
          data-active={panel === "profile"}
          onClick={() => setPanel("profile")}
        >
          Profile
        </button>
      </nav>

      {panel === "chat" ? (
        <>
          <div
            className="thread-scroll"
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            <div className="thread-messages" data-testid="thread-messages">
              {messages.length === 0 && !runningTurn ? (
                <ThreadIntro bot={bot} onPick={(text) => void sendMessage(text)} />
              ) : null}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
                const grouped =
                  !newDay &&
                  !!prev &&
                  prev.author.type === m.author.type &&
                  prev.author.id === m.author.id &&
                  !prev.inputRequestId &&
                  Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
                return (
                  <Fragment key={m.id}>
                    {newDay ? (
                      <div className="day-separator" role="separator">
                        <span>{dayLabel(m.createdAt)}</span>
                      </div>
                    ) : null}
                    {m.text === "__digest__" || m.dedupeKey?.startsWith("digest:") ? (
                      <div className="msg msg-digest" data-author="bot">
                        <DigestMessage
                          postedAt={m.createdAt}
                          text={m.text === "__digest__" ? undefined : m.text}
                        />
                      </div>
                    ) : (
                      <MessageWithSteps
                        message={m}
                        bot={bot}
                        bots={bots}
                        grouped={grouped}
                        onQuickReply={(text) => void sendMessage(text)}
                      />
                    )}
                  </Fragment>
                );
              })}
              {runningTurn ? (
                <TurnSteps turn={runningTurn} waitingForUser={threadApprovals.length > 0} />
              ) : null}
              {!runningTurn && latestFailure ? <TurnSteps turn={latestFailure} /> : null}
              {/* What needs the user now sits at the bottom, next to the composer. */}
              {threadApprovals.map((a: Approval) => (
                <ApprovalCard key={a.id} approval={a} onResolve={(r) => resolveApproval(a.id, r)} />
              ))}
            </div>
          </div>
          <Composer
            botName={bot.name}
            running={Boolean(runningTurn)}
            onSend={(text) => sendMessage(text)}
            onStop={stop}
          />
        </>
      ) : null}

      {panel === "computer" && showComputer ? (
        <div className="thread-scroll">
          <div className="panel-page panel-page-wide">
            <ComputerPanel botId={bot.id} />
          </div>
        </div>
      ) : null}

      {panel === "profile" ? (
        <div className="thread-scroll">
          <div className="panel-page">
            <BotProfileEditor bot={bot} />
            <BotConnectorsCard bot={bot} />
            <BotWhyPanel botId={bot.id} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function oneLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

const COS_SUGGESTIONS = [
  "Ask me a few questions to get to know me",
  "What can you and your team do for me?",
  "Set up a bot that tracks news in my field",
];

function ThreadIntro({ bot, onPick }: { bot: Bot; onPick: (text: string) => void }) {
  const suggestions = bot.isChiefOfStaff
    ? COS_SUGGESTIONS
    : ["What can you do?", "Here's your first task:"];
  return (
    <div className="thread-intro">
      <BotAvatar bot={bot} size={56} />
      <h2>{bot.isChiefOfStaff ? "Hi, I'm your Chief of Staff" : `Hi, I'm ${bot.name}`}</h2>
      <p>
        {bot.isChiefOfStaff
          ? "Tell me what you need. I handle it myself or bring in the right bot, and only come back when it's done or I need you."
          : oneLine(bot.description) || "Tell me what you need."}
      </p>
      <div className="thread-intro-suggestions">
        {suggestions.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => onPick(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageWithSteps({
  message,
  bot,
  bots,
  grouped,
  onQuickReply,
}: {
  message: Message;
  bot: Bot;
  bots: Bot[];
  grouped: boolean;
  onQuickReply: (text: string) => void;
}) {
  const { state } = useOpenBot();
  const turnId = state.turnByMessage.get(message.id);
  const turn = turnId ? state.turns.get(turnId) : undefined;
  const request = message.inputRequestId ? state.inputs.get(message.inputRequestId) : undefined;
  return (
    <>
      {turn && turn.status !== "running" ? <TurnSteps turn={turn} /> : null}
      {request ? (
        <InputRequestCard request={request} />
      ) : (
        <MessageItem
          message={message}
          bot={bot}
          bots={bots}
          grouped={grouped && !turn}
          onQuickReply={onQuickReply}
        />
      )}
    </>
  );
}
