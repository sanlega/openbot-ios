import type { OBEvent } from "@openbot/contracts";
import { notificationContent } from "./notify-filter.js";
import { threadDeepLink } from "./deep-link.js";

export interface DesktopNotificationLike {
  show(): void;
  on(event: "click", listener: () => void): void;
}

export interface NotificationFactory {
  isSupported(): boolean;
  create(options: { title: string; body: string }): DesktopNotificationLike;
}

/** Shows OS notifications for push-worthy events; click opens the thread via deep link. */
export function showPushNotification(
  factory: NotificationFactory,
  event: OBEvent,
  onDeepLink: (url: string) => void,
): boolean {
  if (!factory.isSupported()) return false;
  const { title, body, threadId } = notificationContent(event);
  const notification = factory.create({ title, body });
  notification.on("click", () => {
    if (threadId) onDeepLink(threadDeepLink(threadId));
    else onDeepLink("openbot://home");
  });
  notification.show();
  return true;
}
