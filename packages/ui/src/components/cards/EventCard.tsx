import type { OBEvent } from "@openbot/contracts";
import { EVENT_TYPES } from "@openbot/contracts";

const EVENT_LABELS: Record<string, string> = {
  "message.created": "Message created",
  "message.delta": "Streaming…",
  "message.completed": "Message complete",
  "message.held": "Message held",
  "message.merged": "Message merged",
  "turn.queued": "Turn queued",
  "turn.started": "Turn started",
  "turn.completed": "Turn completed",
  "turn.failed": "Turn failed",
  "turn.interrupted": "Turn interrupted",
  "tool.started": "Tool started",
  "tool.completed": "Tool completed",
  "action.simulated": "Action simulated (dry run)",
  "approval.requested": "Approval requested",
  "approval.resolved": "Approval resolved",
  "handoff.sent": "Handoff sent",
  "handoff.received": "Handoff received",
  "bot.created": "Bot created",
  "bot.updated": "Bot updated",
  "bot.archived": "Bot archived",
  "bot.archive_suggested": "Archive suggested",
  "route.decided": "Route decided",
  "gate.decided": "Gate decided",
  "chain.limit_reached": "Chain limit reached",
  "guard.tripped": "Guard tripped",
  "cap.hit": "Cap hit",
  "chain.resumed": "Chain resumed",
  "chain.stopped": "Chain stopped",
  "attention.changed": "Attention changed",
  "notify.requested": "Notify requested",
  "digest.posted": "Daily digest",
  "usage.recorded": "Usage recorded",
  "decision.made": "Decision made",
  "computer.status": "Computer status",
  "computer.task_started": "Computer task started",
  "computer.step": "Computer step",
  "computer.escalated": "Computer escalated",
  "computer.takeover_requested": "Takeover requested",
  "computer.takeover_ended": "Takeover ended",
  "computer.task_completed": "Computer task completed",
  "routine.created": "Routine created",
  "routine.updated": "Routine updated",
  "routine.deleted": "Routine deleted",
  "routine.paused": "Routine paused",
  "routine.resumed": "Routine resumed",
  "trigger.received": "Trigger received",
  "routine.run_queued": "Routine run queued",
  "routine.run_started": "Routine run started",
  "routine.run_completed": "Routine run completed",
  "routine.run_skipped": "Routine run skipped",
  "device.paired": "Device paired",
  "device.revoked": "Device revoked",
  "remote.status": "Remote status",
  "connector.connected": "Connector connected",
  "connector.disconnected": "Connector disconnected",
  "setup.changed": "Setup changed",
  "engine.status": "Engine status",
  error: "Error",
};

function cardKind(type: string): string {
  if (type.startsWith("approval")) return "approval";
  if (type === "route.decided") return "route";
  if (type.startsWith("chain") || type === "guard.tripped") return "chain";
  if (type.startsWith("computer")) return "computer";
  if (type.startsWith("routine")) return "routine";
  return "default";
}

interface EventCardProps {
  event: OBEvent;
}

/** Renders any OBEvent type — used in thread timeline and activity audit trail. */
export function EventCard({ event }: EventCardProps) {
  const label = EVENT_LABELS[event.type] ?? event.type;
  const summary = summarizePayload(event);

  return (
    <div className="event-card" data-kind={cardKind(event.type)} data-event-type={event.type}>
      <strong>{label}</strong>
      {summary ? <> — {summary}</> : null}
    </div>
  );
}

function summarizePayload(event: OBEvent): string {
  const p = event.payload;
  if (typeof p.summary === "string") return p.summary;
  if (typeof p.text === "string") return p.text;
  if (typeof p.reason === "string") return p.reason;
  if (typeof p.engine === "string" && typeof p.model === "string") {
    return `${p.engine} / ${p.model}`;
  }
  return "";
}

/** Ensures every contract event type has a label (acceptance: every event type renders). */
export function allEventTypesLabeled(): boolean {
  return EVENT_TYPES.every((t) => t in EVENT_LABELS);
}
