import { useEffect, useState } from "react";
import type { ActivityEntry } from "../../api/types.js";
import { useOpenBot } from "../../state/context.js";
import { EventCard } from "../cards/EventCard.js";

type ActivityFilter = "all" | "held";

export function ActivityView() {
  const { transport } = useOpenBot();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    const path = filter === "held" ? "/api/activity?delivery=held" : "/api/activity";
    void transport.get<{ events: ActivityEntry[] }>(path).then((res) => setEntries(res.events));
  }, [transport, filter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }} data-testid="activity-view">
      <div className="nav-tabs">
        <button
          type="button"
          className="nav-tab"
          data-active={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All activity
        </button>
        <button
          type="button"
          className="nav-tab"
          data-active={filter === "held"}
          onClick={() => setFilter("held")}
        >
          Not delivered
        </button>
      </div>
      <div className="activity-list">
        {entries.length === 0 ? (
          <div className="empty-state">No activity entries</div>
        ) : (
          entries.map((entry) => (
            <article key={entry.id} className="activity-item">
              <time dateTime={entry.ts}>{new Date(entry.ts).toLocaleString()}</time>
              <div>{entry.summary}</div>
              {entry.delivery === "held" ? (
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <PromoteMuteButtons messageId={entry.messageId} transport={transport} action="promote" />
                  <PromoteMuteButtons messageId={entry.messageId} transport={transport} action="mute" />
                </div>
              ) : null}
              <EventCard
                event={{
                  id: entry.id,
                  seq: 0,
                  ts: entry.ts,
                  type: entry.type as "message.held",
                  botId: entry.botId,
                  threadId: entry.threadId,
                  payload: { summary: entry.summary },
                }}
              />
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function PromoteMuteButtons({
  messageId,
  transport,
  action,
}: {
  messageId?: string;
  transport: ReturnType<typeof useOpenBot>["transport"];
  action: "promote" | "mute";
}) {
  if (!messageId) return null;
  return (
    <button
      type="button"
      className="icon-button"
      style={{ width: "auto", padding: "4px 12px" }}
      onClick={() => void transport.post(`/api/messages/${messageId}/${action}`)}
    >
      {action === "promote" ? "Promote" : "Mute"}
    </button>
  );
}

export function AuditView() {
  const { transport } = useOpenBot();
  const [entries, setEntries] = useState<
    Array<{ id: string; ts: string; actor: string; action: string; detail: string }>
  >([]);

  useEffect(() => {
    void transport.get<{ entries: typeof entries }>("/api/audit").then((res) => setEntries(res.entries));
  }, [transport]);

  return (
    <div className="audit-list" data-testid="audit-view">
      {entries.map((entry) => (
        <article key={entry.id} className="audit-item">
          <time dateTime={entry.ts}>{new Date(entry.ts).toLocaleString()}</time>
          <div>
            <strong>{entry.actor}</strong> — {entry.action}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>{entry.detail}</div>
        </article>
      ))}
    </div>
  );
}
