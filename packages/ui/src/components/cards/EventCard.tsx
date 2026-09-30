import type { EventType, OBEvent } from "@openbot/contracts";
import { EVENT_TYPES } from "@openbot/contracts";
import { useOptionalOpenBot } from "../../state/context.js";
import { plainText } from "../activity/format.js";

/** Plain-language names for every event type; never shown as raw ids like "message.held". */
const EVENT_LABELS: Record<EventType, string> = {
  "message.created": "New message",
  "message.delta": "Writing…",
  "message.completed": "Message sent",
  "message.held": "Held for digest",
  "message.merged": "Merged into another update",
  "turn.queued": "Waiting to start",
  "turn.started": "Started working",
  "turn.completed": "Finished working",
  "turn.failed": "Ran into a problem",
  "turn.interrupted": "Stopped",
  "tool.started": "Using a tool",
  "tool.completed": "Used a tool",
  "action.simulated": "Would have acted (dry run)",
  "approval.requested": "Asked for your OK",
  "approval.resolved": "You answered a request",
  "input.requested": "Asked you",
  "input.answered": "You answered",
  "input.dismissed": "You skipped a form",
  "input.cancelled": "Form withdrawn",
  "handoff.sent": "Handed off work",
  "handoff.received": "Picked up a handoff",
  "delegation.updated": "Task status changed",
  "bot.created": "Bot created",
  "bot.updated": "Bot updated",
  "bot.archived": "Bot archived",
  "bot.archive_suggested": "Suggested archiving a bot",
  "route.decided": "Picked an engine",
  "gate.decided": "Chief of Staff decided",
  "chain.limit_reached": "Reached its step limit",
  "guard.tripped": "Loop guard stepped in",
  "cap.hit": "Hit a limit",
  "chain.resumed": "Resumed",
  "chain.stopped": "Stopped",
  "attention.changed": "Attention changed",
  "notify.requested": "Wanted to notify you",
  "digest.posted": "Daily digest",
  "usage.recorded": "Usage recorded",
  "decision.made": "Made a decision",
  "computer.status": "Computer status",
  "computer.image_status": "Desktop image status",
  "computer.task_started": "Started a computer task",
  "computer.step": "Computer step",
  "computer.escalated": "Needs help on the computer",
  "computer.takeover_requested": "Asked you to take over",
  "computer.takeover_ended": "Takeover ended",
  "computer.task_completed": "Finished a computer task",
  "routine.created": "Routine created",
  "routine.updated": "Routine updated",
  "routine.deleted": "Routine deleted",
  "routine.paused": "Routine paused",
  "routine.resumed": "Routine resumed",
  "trigger.received": "Trigger received",
  "routine.run_queued": "Routine run queued",
  "routine.run_started": "Routine run started",
  "routine.run_completed": "Routine run finished",
  "routine.run_skipped": "Routine run skipped",
  "device.paired": "Device paired",
  "device.revoked": "Device removed",
  "remote.status": "Remote access changed",
  "connector.connected": "App connected",
  "connector.disconnected": "App disconnected",
  "setup.changed": "Setup changed",
  "engine.status": "Engine status",
  error: "Something went wrong",
};

export function eventLabel(type: string): string {
  return (EVENT_LABELS as Record<string, string>)[type] ?? "Update";
}

function cardKind(type: string): string {
  if (type.startsWith("approval") || type.startsWith("input")) return "approval";
  if (type === "route.decided") return "route";
  if (type.startsWith("chain") || type === "guard.tripped" || type === "cap.hit") return "chain";
  if (type.startsWith("computer")) return "computer";
  if (type.startsWith("routine")) return "routine";
  if (type === "error" || type === "turn.failed") return "error";
  return "default";
}

interface EventCardProps {
  event: OBEvent;
}

/** Renders any OBEvent as "<Bot> · <what happened> — <short detail>". */
export function EventCard({ event }: EventCardProps) {
  const openbot = useOptionalOpenBot();
  const bot = event.botId ? openbot?.bots.find((b) => b.id === event.botId) : undefined;
  const summary = summarizePayload(event);

  return (
    <div className="event-card" data-kind={cardKind(event.type)} data-event-type={event.type}>
      {bot ? <span className="event-card-bot">{bot.name}</span> : null}
      <strong>{eventLabel(event.type)}</strong>
      {summary ? <span className="event-card-detail">{summary}</span> : null}
    </div>
  );
}

function summarizePayload(event: OBEvent): string {
  const p = event.payload;
  const text =
    typeof p.summary === "string"
      ? p.summary
      : typeof p.text === "string"
        ? p.text
        : typeof p.reason === "string"
          ? p.reason
          : "";
  if (text) {
    const plain = plainText(text);
    return plain.length > 160 ? `${plain.slice(0, 157)}…` : plain;
  }
  if (typeof p.engine === "string" && typeof p.model === "string") {
    return `${p.engine} / ${p.model}`;
  }
  return "";
}

/** Ensures every contract event type has a label (acceptance: every event type renders). */
export function allEventTypesLabeled(): boolean {
  return EVENT_TYPES.every((t) => t in EVENT_LABELS);
}
