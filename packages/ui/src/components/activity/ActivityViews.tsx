import { useEffect, useMemo, useRef, useState } from "react";
import { engineName as settingsEngineName } from "../settings/settings-meta.js";
import type { Approval, Bot, InputRequest, Message, Turn } from "@openbot/contracts";
import {
  BellOff,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Inbox,
  MessageSquare,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useOpenBot } from "../../state/context.js";
import { modelLabel } from "../thread/RouteChip.js";
import { BotAvatar } from "../common/BotAvatar.js";
import { ScreenHeader } from "../common/ScreenHeader.js";
import { dayLabel, sameDay } from "../common/time.js";
import { MessageText } from "../thread/MessageText.js";
import {
  APPROVAL_TITLES,
  approvalAction,
  approvalOutcome,
  approvalTarget,
  botNamer,
  fullTime,
  humanReason,
  parseApproval,
  plainText,
  relativeTime,
} from "./format.js";

/** Re-reads a REST list shortly after live events settle (streaming emits many). */
function useRefetchOnEvents(load: () => void, key: unknown) {
  const { state } = useOpenBot();
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    loadRef.current();
  }, [key]);
  useEffect(() => {
    if (state.lastSeq === 0) return;
    const timer = setTimeout(() => loadRef.current(), 700);
    return () => clearTimeout(timer);
  }, [state.lastSeq]);
}

function Author({ bot, fallback }: { bot?: Bot; fallback: string }) {
  if (bot) return <BotAvatar bot={bot} size={32} />;
  return (
    <span className="avatar feed-avatar-system" style={{ width: 32, height: 32 }} aria-hidden>
      {fallback.slice(0, 1)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Activity: "Waiting on you" inbox + feed                            */
/* ------------------------------------------------------------------ */

type ActivityFilter = "all" | "result" | "decision" | "held";

const FILTERS: Array<{ id: ActivityFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "result", label: "Results" },
  { id: "decision", label: "Decisions" },
  { id: "held", label: "Held for digest" },
];

const KIND_PILLS: Record<NonNullable<Message["kind"]>, { label: string; tone: string }> = {
  result: { label: "Result", tone: "pill-success" },
  decision: { label: "Needs a decision", tone: "pill-accent" },
  blocker: { label: "Blocked", tone: "pill-danger" },
};

const PAGE = 50;

/**
 * The feed lists what bots sent on their own (results, questions, held
 * messages, routine and system posts); plain replies stay in each chat.
 */
function isUpdate(m: Message): boolean {
  if (m.author.type === "user") return false;
  if (m.author.type !== "bot") return true;
  return Boolean(m.proactive || m.kind || m.inputRequestId || m.delivery !== "delivered");
}

interface ActivityViewProps {
  /** Called after a thread is selected, so the shell can switch to the chat. */
  onOpenThread?: () => void;
}

export function ActivityView({ onOpenThread }: ActivityViewProps = {}) {
  const { transport, bots, threads, pendingApprovals, state, selectThread } = useOpenBot();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const names = useMemo(() => botNamer(bots), [bots]);

  useRefetchOnEvents(() => {
    void transport
      .get<{ messages: Message[] }>("/api/activity")
      .then((res) => setMessages(res.messages))
      .catch(() => setMessages((m) => m ?? []));
  }, transport);

  const openThread = (threadId?: string, botId?: string) => {
    const id = threadId ?? threads.find((t) => t.botId === botId)?.id;
    if (!id) return;
    selectThread(id);
    onOpenThread?.();
  };

  const feed = useMemo(
    () =>
      (messages ?? [])
        .filter((m) => m.text !== "__digest__" && m.text.trim() && isUpdate(m))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [messages],
  );
  const counts = useMemo(() => {
    const c: Record<ActivityFilter, number> = { all: feed.length, result: 0, decision: 0, held: 0 };
    for (const m of feed) {
      if (m.delivery === "held") c.held++;
      if (m.kind === "result") c.result++;
      if (m.kind === "decision" || m.kind === "blocker") c.decision++;
    }
    return c;
  }, [feed]);
  const visible = feed.filter((m) => {
    if (filter === "held") return m.delivery === "held";
    if (filter === "result") return m.kind === "result";
    if (filter === "decision") return m.kind === "decision" || m.kind === "blocker";
    return true;
  });

  const waitingInputs = [...state.inputs.values()].filter((i) => i.status === "pending");
  const waiting: Array<{ key: string; ts: string; approval?: Approval; input?: InputRequest }> = [
    ...pendingApprovals.map((a) => ({ key: a.id, ts: a.createdAt, approval: a })),
    ...waitingInputs.map((i) => ({ key: i.id, ts: i.createdAt, input: i })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));

  return (
    <div className="screen" data-testid="activity-view">
      <ScreenHeader
        title="Activity"
        subtitle={
          waiting.length > 0
            ? `${waiting.length} ${waiting.length === 1 ? "thing needs" : "things need"} you`
            : "Updates your bots sent on their own; replies stay in each chat"
        }
      />
      <div className="screen-body">
        <div className="screen-content">
          <section className="inbox" aria-labelledby="inbox-title">
            <h2 className="section-title" id="inbox-title">
              Waiting on you
              {waiting.length > 0 ? (
                <span className="pill pill-warning">{waiting.length}</span>
              ) : null}
            </h2>
            {waiting.length === 0 ? (
              <div className="inbox-clear">
                <CheckCircle2 size={16} aria-hidden />
                You're all caught up. Approvals and questions from your bots show up here.
              </div>
            ) : (
              <div className="row-list">
                {waiting.map(({ key, ts, approval, input }) => {
                  const botId = approval?.botId ?? input?.botId;
                  const bot = names.get(botId);
                  const title = approval
                    ? APPROVAL_TITLES[approval.kind]
                    : "Asked you to fill in a form";
                  const what = approval
                    ? approvalAction(approval, names.humanize)
                    : (input?.title ?? "");
                  const target = approval ? approvalTarget(approval) : undefined;
                  return (
                    <div key={key} className="row inbox-row">
                      <Author bot={bot} fallback={names.name(botId)} />
                      <div className="row-main">
                        <div className="inbox-line">
                          <span className="row-title">{names.name(botId)}</span>
                          <span className="inbox-what">{title}</span>
                        </div>
                        <div className="row-sub">
                          {what}
                          {target && target !== what ? (
                            <code className="inline-code">{target}</code>
                          ) : null}
                        </div>
                      </div>
                      <time className="row-meta" dateTime={ts} title={fullTime(ts)}>
                        {relativeTime(ts)}
                      </time>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => openThread(input?.threadId, botId)}
                        aria-label={`Open ${names.name(botId)}'s chat`}
                      >
                        Open
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="feed" aria-labelledby="feed-title">
            <div className="feed-toolbar">
              <h2 className="section-title" id="feed-title">
                Feed
              </h2>
              <div className="filter-tabs" role="group" aria-label="Filter activity">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="filter-tab"
                    aria-pressed={filter === f.id}
                    onClick={() => {
                      setFilter(f.id);
                      setLimit(PAGE);
                    }}
                  >
                    {f.label}
                    {counts[f.id] > 0 && f.id !== "all" ? (
                      <span className="filter-count" aria-hidden>
                        {counts[f.id]}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            {filter === "held" ? (
              <p className="feed-help">
                Messages the Chief of Staff held back because they didn't seem worth a notification.
                Deliver one to post it in the chat, or mark it as noise so fewer like it get
                through.
              </p>
            ) : null}

            {messages === null ? (
              <div className="feed-skeleton" aria-hidden>
                <span />
                <span />
                <span />
              </div>
            ) : visible.length === 0 ? (
              <EmptyFeed filter={filter} />
            ) : (
              <ol className="feed-list">
                {visible.slice(0, limit).map((m, i, list) => {
                  const prev = list[i - 1];
                  const showDay = !prev || !sameDay(prev.createdAt, m.createdAt);
                  return (
                    <li key={m.id}>
                      {showDay ? <div className="feed-day">{dayLabel(m.createdAt)}</div> : null}
                      <FeedItem
                        message={m}
                        bot={m.author.type === "bot" ? names.get(m.author.id) : undefined}
                        authorName={
                          m.author.type === "bot"
                            ? names.name(m.author.id)
                            : m.author.type === "routine"
                              ? "Routine"
                              : "OpenBot"
                        }
                        onOpen={() => openThread(m.threadId)}
                        onChanged={(next) =>
                          setMessages((all) =>
                            (all ?? []).map((x) => (x.id === next.id ? next : x)),
                          )
                        }
                      />
                    </li>
                  );
                })}
              </ol>
            )}
            {visible.length > limit ? (
              <button
                type="button"
                className="btn btn-secondary feed-more"
                onClick={() => setLimit((l) => l + PAGE)}
              >
                Show older
              </button>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function EmptyFeed({ filter }: { filter: ActivityFilter }) {
  const copy: Record<ActivityFilter, [string, string]> = {
    all: [
      "No activity yet",
      "When your bots post results, ask for decisions or work on routines, it shows up here.",
    ],
    result: ["No results yet", "Finished work from your bots will be listed here."],
    decision: ["Nothing to decide", "When a bot needs a call from you, it shows up here."],
    held: [
      "Nothing held back",
      "Every message your bots sent was delivered. Held messages would appear here.",
    ],
  };
  const [title, text] = copy[filter];
  return (
    <div className="empty-block">
      <Inbox size={22} aria-hidden />
      <p className="empty-title">{title}</p>
      <p className="empty-text">{text}</p>
    </div>
  );
}

function FeedItem({
  message,
  bot,
  authorName,
  onOpen,
  onChanged,
}: {
  message: Message;
  bot?: Bot;
  authorName: string;
  onOpen: () => void;
  onChanged: (m: Message) => void;
}) {
  const { transport } = useOpenBot();
  const [expanded, setExpanded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const long = message.text.length > 280 || message.text.split("\n").length > 5;
  const held = message.delivery === "held";
  const kind = message.kind ? KIND_PILLS[message.kind] : undefined;

  const act = async (action: "promote" | "mute") => {
    setBusy(true);
    try {
      const res = await transport.post<{ message?: Message }>(
        `/api/messages/${message.id}/${action}`,
      );
      if (action === "mute") setMuted(true);
      else onChanged(res?.message ?? { ...message, delivery: "delivered" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="feed-item" data-held={held || undefined}>
      <Author bot={bot} fallback={authorName} />
      <div className="feed-main">
        <header className="feed-head">
          <span className="feed-author">{authorName}</span>
          {kind ? <span className={`pill ${kind.tone}`}>{kind.label}</span> : null}
          {held ? <span className="pill pill-warning">Held for digest</span> : null}
          {message.inputRequestId ? <span className="pill pill-accent">Asked you</span> : null}
          {message.proactive && !kind && !held && !message.inputRequestId ? (
            <span className="pill pill-muted">Update</span>
          ) : null}
          <time
            className="feed-time"
            dateTime={message.createdAt}
            title={fullTime(message.createdAt)}
          >
            {relativeTime(message.createdAt)}
          </time>
        </header>
        <div
          className="feed-body"
          data-clamped={long && !expanded ? true : undefined}
          aria-label={plainText(message.text).slice(0, 140)}
        >
          <MessageText text={message.text} markdown />
        </div>
        <div className="feed-actions">
          {long ? (
            <button
              type="button"
              className="link-btn"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
          <button type="button" className="link-btn" onClick={onOpen}>
            <MessageSquare size={13} aria-hidden /> Open chat
          </button>
          {held && !muted ? (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => void act("promote")}
                title="Post it in the chat now"
              >
                <Send size={13} aria-hidden /> Deliver
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => void act("mute")}
                title="Teach the Chief of Staff to hold messages like this"
              >
                <BellOff size={13} aria-hidden /> Mark as noise
              </button>
            </>
          ) : null}
          {muted ? <span className="feed-note">Got it — fewer like this.</span> : null}
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Audit: who did what, and who allowed it                             */
/* ------------------------------------------------------------------ */

type AuditKind = "all" | "approvals" | "work";

interface AuditRow {
  id: string;
  ts: string;
  botId: string;
  kind: "approval" | "turn";
  action: string;
  sub?: string;
  outcome: { label: string; tone: string };
  target?: string;
  details: Array<[string, string]>;
  raw?: string;
}

const TURN_STATUS: Record<string, { label: string; tone: string }> = {
  completed: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  interrupted: { label: "Stopped", tone: "muted" },
  running: { label: "Working", tone: "accent" },
  queued: { label: "Queued", tone: "muted" },
};

function engineName(engine: string): string {
  if (engine === "codex") return "Codex";
  return settingsEngineName(engine);
}

export function AuditView() {
  const { transport, bots, state } = useOpenBot();
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [botFilter, setBotFilter] = useState<string>("all");
  const [kind, setKind] = useState<AuditKind>("all");
  const [open, setOpen] = useState<string | null>(null);
  const names = useMemo(() => botNamer(bots), [bots]);
  const botIds = bots.map((b) => b.id).join(",");

  useRefetchOnEvents(() => {
    void transport
      .get<{ approvals: Approval[] }>("/api/audit")
      .then((res) => setApprovals(res.approvals ?? []))
      .catch(() => setApprovals((a) => a ?? []));
    // Turns are listed per Bot; the roster is small.
    void Promise.all(
      bots.map((b) =>
        transport
          .get<{ turns?: Turn[] }>(`/api/audit?botId=${encodeURIComponent(b.id)}`)
          .then((res) => res.turns ?? [])
          .catch(() => [] as Turn[]),
      ),
    ).then((lists) => setTurns(lists.flat()));
  }, botIds);

  const rows = useMemo<AuditRow[]>(() => {
    const out: AuditRow[] = [];
    for (const a of approvals ?? []) {
      const outcome = approvalOutcome(a);
      const { reason, tool } = parseApproval(a);
      const details: Array<[string, string]> = [
        ["Request", APPROVAL_TITLES[a.kind]],
        ["Asked", fullTime(a.createdAt)],
      ];
      if (a.risk !== undefined) details.push(["Risk", `${Math.round(a.risk * 100)}%`]);
      if (tool) details.push(["Tool", tool]);
      if (reason) details.push(["Why it asked", names.humanize(humanReason(reason))]);
      out.push({
        id: a.id,
        ts: a.createdAt,
        botId: a.botId,
        kind: "approval",
        action: approvalAction(a, names.humanize),
        outcome: { label: outcome.label, tone: outcome.tone },
        target: approvalTarget(a),
        details,
        raw: a.detail && a.detail !== approvalTarget(a) ? a.detail : undefined,
      });
    }
    // What each turn was about: the message that started its chain (yours, or
    // a task from another bot).
    const askedFor = new Map<string, string>();
    for (const messages of state.messagesByThread.values()) {
      for (const m of [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
        if (!m.chainId || askedFor.has(m.chainId) || m.author.type === "system") continue;
        const line = plainText(m.text).slice(0, 90);
        if (line) askedFor.set(m.chainId, line);
      }
    }
    for (const t of turns) {
      const tokens = t.usage.inputTokens + t.usage.outputTokens;
      out.push({
        id: t.id,
        ts: t.createdAt,
        botId: t.botId,
        kind: "turn",
        action: askedFor.get(t.chainId) ?? "Worked on a task",
        sub: `${engineName(t.engine)} · ${modelLabel(t.model)}`,
        outcome:
          t.status === "running" &&
          (approvals ?? []).some((a) => a.status === "pending" && a.chainId === t.chainId)
            ? { label: "Waiting for you", tone: "warning" }
            : (TURN_STATUS[t.status] ?? { label: t.status, tone: "muted" }),
        details: [
          [
            "Engine",
            `${engineName(t.engine)} · ${modelLabel(t.model)}${t.effort ? ` · ${t.effort}` : ""}`,
          ],
          ["Started", fullTime(t.createdAt)],
          ["Usage", `${tokens.toLocaleString()} tokens · $${t.usage.usd.toFixed(2)}`],
        ],
      });
    }
    return out.sort((a, b) => b.ts.localeCompare(a.ts));
  }, [approvals, turns, names, state.messagesByThread]);

  const visible = rows.filter(
    (r) =>
      (botFilter === "all" || r.botId === botFilter) &&
      (kind === "all" || (kind === "approvals" ? r.kind === "approval" : r.kind === "turn")),
  );

  return (
    <div className="screen" data-testid="audit-view">
      <ScreenHeader
        title="Audit"
        subtitle="Every action that needed your OK, and every task your bots ran"
      />
      <div className="screen-body">
        <div className="screen-content screen-content-wide">
          <div className="feed-toolbar">
            <div className="filter-tabs" role="group" aria-label="Filter by kind">
              {(
                [
                  ["all", "Everything"],
                  ["approvals", "Approvals"],
                  ["work", "Tasks"],
                ] as Array<[AuditKind, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="filter-tab"
                  aria-pressed={kind === id}
                  onClick={() => setKind(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="select-wrap">
              <span className="screens-sr-only">Filter by bot</span>
              <select value={botFilter} onChange={(e) => setBotFilter(e.target.value)}>
                <option value="all">All bots</option>
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden />
            </label>
          </div>

          {approvals === null ? (
            <div className="feed-skeleton" aria-hidden>
              <span />
              <span />
              <span />
            </div>
          ) : visible.length === 0 ? (
            <div className="empty-block">
              <ShieldCheck size={22} aria-hidden />
              <p className="empty-title">
                {rows.length === 0 ? "Nothing to audit yet" : "No matching entries"}
              </p>
              <p className="empty-text">
                {rows.length === 0
                  ? "When a bot asks to run a command, edit a file or use an app, the request and your answer are recorded here."
                  : "Try another bot or kind."}
              </p>
            </div>
          ) : (
            <div className="audit-table" aria-label="Audit log">
              <div className="audit-tr audit-thead" aria-hidden>
                <span>Time</span>
                <span>Bot</span>
                <span>Action</span>
                <span>Outcome</span>
              </div>
              {visible.map((r) => {
                const isOpen = open === r.id;
                const bot = names.get(r.botId);
                return (
                  <div key={r.id} className="audit-group">
                    <button
                      type="button"
                      className="audit-tr audit-row"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : r.id)}
                    >
                      <time className="audit-time" dateTime={r.ts} title={fullTime(r.ts)}>
                        {relativeTime(r.ts)}
                      </time>
                      <span className="audit-bot">
                        {bot ? <BotAvatar bot={bot} size={22} motion="none" /> : null}
                        <span className="audit-bot-name">{names.name(r.botId)}</span>
                      </span>
                      <span className="audit-action">
                        {r.kind === "approval" ? (
                          <ClipboardList size={14} aria-hidden />
                        ) : (
                          <MessageSquare size={14} aria-hidden />
                        )}
                        <span className="audit-action-text">
                          {r.action}
                          {r.sub ? <span className="audit-action-sub"> · {r.sub}</span> : null}
                        </span>
                      </span>
                      <span className="audit-outcome">
                        <span className={`pill pill-${r.outcome.tone}`}>{r.outcome.label}</span>
                        <ChevronRight size={14} className="audit-chevron" aria-hidden />
                      </span>
                    </button>
                    {isOpen ? (
                      <div className="audit-details">
                        {r.target ? <pre className="audit-code">{r.target}</pre> : null}
                        <dl>
                          {r.details.map(([k, v]) => (
                            <div key={k}>
                              <dt>{k}</dt>
                              <dd>{v}</dd>
                            </div>
                          ))}
                        </dl>
                        {r.raw ? (
                          <details className="audit-raw">
                            <summary>Technical details</summary>
                            <pre className="audit-code">{prettyJson(r.raw)}</pre>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function prettyJson(text: string): string {
  const [first, ...rest] = text.split("\n\n");
  try {
    return [JSON.stringify(JSON.parse(first ?? ""), null, 2), ...rest].join("\n\n");
  } catch {
    return text;
  }
}
