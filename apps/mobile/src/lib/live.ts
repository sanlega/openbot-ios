import type { OBEvent } from "@openbot/contracts";

/** Query-key roots each event can change; the phone refetches only those. */
export function keysForEvent(type: OBEvent["type"]): string[][] {
  if (type === "message.delta") return [];
  if (type.startsWith("message.") || type === "digest.posted") {
    return [
      ["openbot", "messages"],
      ["openbot", "threads"],
      ["openbot", "activity"],
    ];
  }
  if (type.startsWith("turn.")) {
    return [
      ["openbot", "turns"],
      ["openbot", "messages"],
      ["openbot", "threads"],
    ];
  }
  if (type.startsWith("approval."))
    return [
      ["openbot", "approvals"],
      ["openbot", "turns"],
    ];
  if (type.startsWith("input."))
    return [
      ["openbot", "inputs"],
      ["openbot", "messages"],
    ];
  if (type.startsWith("bot."))
    return [
      ["openbot", "bots"],
      ["openbot", "threads"],
    ];
  if (type.startsWith("routine.")) return [["openbot", "routines"]];
  // A worker's result lands in the requester's thread.
  if (type === "delegation.updated")
    return [
      ["openbot", "messages"],
      ["openbot", "threads"],
    ];
  return [];
}

/** Text a Bot is streaming right now, per Bot id. */
export type LiveText = Record<string, string>;

const TURN_END = new Set(["turn.completed", "turn.failed", "turn.interrupted"]);

export function reduceLiveText(live: LiveText, event: OBEvent): LiveText {
  const botId = event.botId;
  if (!botId) return live;
  if (event.type === "message.delta") {
    const payload = event.payload as { text?: unknown } | undefined;
    const text = typeof payload?.text === "string" ? payload.text : "";
    if (!text) return live;
    return { ...live, [botId]: (live[botId] ?? "") + text };
  }
  if (
    TURN_END.has(event.type) ||
    event.type === "message.created" ||
    event.type === "turn.started"
  ) {
    if (!(botId in live)) return live;
    const next = { ...live };
    delete next[botId];
    return next;
  }
  return live;
}

/** A task one Bot handed to another that is still open, keyed by delegation id. */
export interface OpenDelegation {
  id: string;
  requesterBotId: string;
  assigneeBotId: string;
  /** The requester's thread: where the human follows the task and answers the worker. */
  ownerThreadId: string;
  title: string;
  state: "submitted" | "working" | "input_required";
  statusMessage?: string;
}
export type Delegations = Record<string, OpenDelegation>;

const OPEN_STATES = new Set(["submitted", "working", "input_required"]);

/** Tracks open delegations from `delegation.updated`; an ended one drops out. */
export function reduceDelegations(open: Delegations, event: OBEvent): Delegations {
  if (event.type !== "delegation.updated") return open;
  const d = (event.payload as { delegation?: Record<string, unknown> } | undefined)?.delegation;
  const text = (key: string) => (typeof d?.[key] === "string" ? (d[key] as string) : undefined);
  const id = text("id");
  const state = text("state");
  const requesterBotId = text("requesterBotId");
  const assigneeBotId = text("assigneeBotId");
  const ownerThreadId = text("ownerThreadId");
  if (!id || !state || !requesterBotId || !assigneeBotId || !ownerThreadId) return open;
  if (!OPEN_STATES.has(state)) {
    if (!(id in open)) return open;
    const next = { ...open };
    delete next[id];
    return next;
  }
  return {
    ...open,
    [id]: {
      id,
      requesterBotId,
      assigneeBotId,
      ownerThreadId,
      title: text("title") ?? "a task",
      state: state as OpenDelegation["state"],
      statusMessage: text("statusMessage"),
    },
  };
}

/** Why each Bot's latest turn failed, per Bot id; a new turn or reply clears it. */
export type Failures = Record<string, string>;

export function reduceFailures(failures: Failures, event: OBEvent): Failures {
  const botId = event.botId;
  if (!botId) return failures;
  if (event.type === "turn.failed" || event.type === "turn.interrupted") {
    const message = (event.payload as { errorMessage?: unknown } | undefined)?.errorMessage;
    return { ...failures, [botId]: typeof message === "string" ? message : "" };
  }
  if (event.type === "turn.started" || event.type === "turn.completed") {
    if (!(botId in failures)) return failures;
    const next = { ...failures };
    delete next[botId];
    return next;
  }
  return failures;
}
