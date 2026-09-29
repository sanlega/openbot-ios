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
