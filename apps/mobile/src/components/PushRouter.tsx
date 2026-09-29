import { useLastNotificationResponse } from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { pushData } from "@/connection/push";

/** Tapping a notification opens that Bot's chat (or the Inbox for approvals and questions). */
export function PushRouter() {
  const response = useLastNotificationResponse();
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const { botId } = pushData(response.notification);
    if (botId) router.push({ pathname: "/chat/[botId]", params: { botId } });
    else router.push("/(tabs)/inbox");
  }, [response]);
  return null;
}
