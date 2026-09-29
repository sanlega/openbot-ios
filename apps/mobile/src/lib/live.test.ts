import type { OBEvent } from "@openbot/contracts";
import { describe, expect, it } from "vitest";
import { keysForEvent, reduceLiveText } from "./live";

const event = (type: OBEvent["type"], payload: Record<string, unknown> = {}, botId = "bot_a") =>
  ({ id: `evt_${type}`, seq: 1, ts: "2026-09-29T12:00:00.000Z", type, botId, payload }) as OBEvent;

describe("live events", () => {
  it("refetches only the data an event can change", () => {
    expect(keysForEvent("message.delta")).toEqual([]);
    expect(keysForEvent("approval.requested")).toContainEqual(["openbot", "approvals"]);
    expect(keysForEvent("input.answered")).toContainEqual(["openbot", "inputs"]);
    expect(keysForEvent("routine.paused")).toEqual([["openbot", "routines"]]);
    expect(keysForEvent("usage.recorded")).toEqual([]);
  });

  it("accumulates streamed text per bot and clears it when the turn ends", () => {
    let live = reduceLiveText({}, event("message.delta", { text: "Hel" }));
    live = reduceLiveText(live, event("message.delta", { text: "lo" }));
    live = reduceLiveText(live, event("message.delta", { text: "Other" }, "bot_b"));
    expect(live).toEqual({ bot_a: "Hello", bot_b: "Other" });
    live = reduceLiveText(live, event("turn.completed"));
    expect(live).toEqual({ bot_b: "Other" });
    const same = reduceLiveText(live, event("tool.started", {}, "bot_b"));
    expect(same).toBe(live);
  });
});
