/** What a push notification says, built from an event and the host's records. */
export interface PushContent {
  title: string;
  body: string;
  /** Groups notifications per Bot on the lock screen. */
  threadId?: string;
  /** Replaces an earlier notification about the same thing. */
  collapseId?: string;
  data: { botId?: string; threadId?: string; kind: PushKind };
}

export type PushKind = "approval" | "question" | "update" | "reply";

export interface PushEvent {
  type: string;
  botId?: string;
  threadId?: string;
  payload: Record<string, unknown>;
}

export interface PushLookups {
  botName(botId: string | undefined): string;
  approval(id: string): { summary: string; detail: string; kind: string } | undefined;
  input(id: string): { title: string } | undefined;
  message(id: string): { author: { type: string }; text: string; proactive?: boolean } | undefined;
}

const MAX_BODY = 160;

/** Returns the notification for push-worthy events, or undefined for everything else. */
export function pushContentFor(
  event: PushEvent,
  lookups: PushLookups,
  options: { previews: boolean },
): PushContent | undefined {
  const bot = lookups.botName(event.botId);
  const data = (kind: PushKind) => ({ botId: event.botId, threadId: event.threadId, kind });

  if (event.type === "approval.requested") {
    const id = str(event.payload.approvalId) ?? str(event.payload.id);
    const approval = id ? lookups.approval(id) : undefined;
    return {
      title: `${bot} needs your OK`,
      body: options.previews && approval ? approvalAction(approval) : "Open OpenBot to review.",
      threadId: event.botId,
      collapseId: id ? `approval-${id}` : undefined,
      data: data("approval"),
    };
  }

  if (event.type === "input.requested") {
    const id = str(event.payload.requestId);
    const title = (id ? lookups.input(id)?.title : undefined) ?? str(event.payload.title);
    return {
      title: `${bot} has a question`,
      body: options.previews && title ? clip(title) : "Open OpenBot to answer.",
      threadId: event.botId,
      collapseId: id ? `input-${id}` : undefined,
      data: data("question"),
    };
  }

  if (event.type === "message.created") {
    const id = str(event.payload.messageId);
    const message = id ? lookups.message(id) : undefined;
    if (!message || message.author.type !== "bot") return undefined;
    const pushedUpdate = event.payload.pushed === true;
    // Proactive messages only reach the phone when the NotifyGate chose to push them;
    // a reply to something the user asked always does.
    if (message.proactive && !pushedUpdate) return undefined;
    return {
      title: bot,
      body: options.previews ? clip(plain(message.text)) : "New message",
      threadId: event.botId,
      data: data(pushedUpdate ? "update" : "reply"),
    };
  }

  return undefined;
}

/** "Run a command", the tool's own description, or the approval summary, in words. */
export function approvalAction(approval: { summary: string; detail: string }): string {
  const routine = /^Enable live runs for routine "(.+)"\?$/.exec(approval.summary);
  if (routine) return `Turn on live runs for “${routine[1]}”`;
  let input: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(approval.detail.split("\n\n")[0] ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      input = parsed as Record<string, unknown>;
    }
  } catch {
    input = undefined;
  }
  const description = str(input?.description);
  if (description) return clip(description);
  if (str(input?.command)) return "Run a command";
  const file = str(input?.file_path) ?? str(input?.path);
  if (file) return `Edit ${file.split(/[\\/]/).pop()}`;
  return clip(approval.summary.replace(/ requested by \S+$/, "").replace(/\?$/, ""));
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function clip(text: string): string {
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1).trimEnd()}…` : text;
}

function plain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}
