import * as Notifications from "expo-notifications";
import type { MobileClient } from "./client";

/** The chat on screen right now; its own notifications don't need a banner. */
let visibleBotId: string | undefined;

export function setVisibleChat(botId: string | undefined): void {
  visibleBotId = botId;
}

export interface PushData {
  botId?: string;
  threadId?: string;
  kind?: "approval" | "question" | "update" | "reply";
}

export function pushData(notification: Notifications.Notification): PushData {
  const data = notification.request.content.data as Record<string, unknown> | undefined;
  return {
    botId: typeof data?.botId === "string" ? data.botId : undefined,
    threadId: typeof data?.threadId === "string" ? data.threadId : undefined,
    kind: typeof data?.kind === "string" ? (data.kind as PushData["kind"]) : undefined,
  };
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const { botId, kind } = pushData(notification);
    // A reply in the chat you're reading is already on screen.
    const quiet = kind === "reply" && !!botId && botId === visibleBotId;
    return {
      shouldShowBanner: !quiet,
      shouldShowList: !quiet,
      shouldPlaySound: !quiet,
      shouldSetBadge: false,
    };
  },
});

export class PushUnavailableError extends Error {}

/**
 * Asks for permission, reads this iPhone's APNs token, and hands it to the desktop.
 * Throws a readable error when the user declines or the build can't receive push.
 */
export async function enablePush(client: MobileClient): Promise<{ configured: boolean }> {
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted
    ? current
    : await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      });
  if (!permission.granted) {
    throw new PushUnavailableError(
      "Notifications are off for OpenBot. Turn them on in the iPhone Settings app.",
    );
  }
  let token: string;
  try {
    token = String((await Notifications.getDevicePushTokenAsync()).data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/aps-environment/i.test(message)) {
      throw new PushUnavailableError(
        "This copy of the app wasn't signed for notifications. Build it with a paid Apple Developer team.",
      );
    }
    throw new PushUnavailableError(`iOS didn't give a notification token: ${message}`);
  }
  const status = await client.registerPush(token);
  return { configured: status.configured ?? false };
}

/** Re-sends the current token after launch; tokens can change after a restore or update. */
export async function refreshPushToken(client: MobileClient): Promise<void> {
  const status = await client.getPushStatus();
  if (!status.registered) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const token = String((await Notifications.getDevicePushTokenAsync()).data);
  await client.registerPush(token);
}
