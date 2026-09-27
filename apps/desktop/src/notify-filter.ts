import type { OBEvent } from "@openbot/contracts";

export interface NotifyRequestedPayload {
  kind?: string;
  delivery?: string;
  pushed?: boolean;
  title?: string;
  body?: string;
}

/** Desktop shows OS notifications only for `notify.requested` events with `pushed: true` (plan §5 WS6). */
export function shouldPushNotification(event: Pick<OBEvent, "type" | "payload">): boolean {
  if (event.type !== "notify.requested") return false;
  const payload = event.payload as NotifyRequestedPayload;
  return payload.pushed === true;
}

export function notificationContent(event: Pick<OBEvent, "payload" | "threadId" | "botId">): {
  title: string;
  body: string;
  threadId?: string;
} {
  const payload = event.payload as NotifyRequestedPayload;
  const title = payload.title ?? "OpenBot";
  const body = payload.body ?? `New ${payload.kind ?? "message"}`;
  return { title, body, threadId: event.threadId };
}
