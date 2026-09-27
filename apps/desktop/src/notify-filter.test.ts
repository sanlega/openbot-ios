import { describe, expect, it } from "vitest";
import { notificationContent, shouldPushNotification } from "./notify-filter.js";

describe("shouldPushNotification", () => {
  it("allows only pushed notify.requested events", () => {
    expect(
      shouldPushNotification({
        type: "notify.requested",
        payload: { pushed: true, kind: "result" },
      }),
    ).toBe(true);
    expect(
      shouldPushNotification({
        type: "notify.requested",
        payload: { pushed: false, kind: "result" },
      }),
    ).toBe(false);
    expect(
      shouldPushNotification({
        type: "message.created",
        payload: { pushed: true },
      }),
    ).toBe(false);
  });
});

describe("notificationContent", () => {
  it("uses payload title/body when present", () => {
    expect(
      notificationContent({
        threadId: "thr_1",
        botId: "bot_1",
        payload: { title: "Hi", body: "Done", kind: "result" },
      }),
    ).toEqual({ title: "Hi", body: "Done", threadId: "thr_1" });
  });
});
