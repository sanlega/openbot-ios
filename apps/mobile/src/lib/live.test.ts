import type { OBEvent } from "@openbot/contracts";
import { describe, expect, it } from "vitest";
import { keysForEvent, reduceDelegations, reduceFailures, reduceLiveText } from "./live";

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

  it("tracks open delegations and drops them when they end", () => {
    const delegation = (state: string, extra: Record<string, unknown> = {}) =>
      event(
        "delegation.updated",
        {
          delegation: {
            id: "del_1",
            requesterBotId: "bot_chief",
            assigneeBotId: "bot_a",
            ownerThreadId: "thr_chief",
            title: "Draft the release notes",
            state,
            ...extra,
          },
        },
        "bot_a",
      );
    let open = reduceDelegations({}, delegation("working"));
    expect(open.del_1).toMatchObject({ assigneeBotId: "bot_a", state: "working" });
    open = reduceDelegations(open, delegation("input_required", { statusMessage: "Which tag?" }));
    expect(open.del_1).toMatchObject({ state: "input_required", statusMessage: "Which tag?" });
    open = reduceDelegations(open, delegation("completed"));
    expect(open).toEqual({});
    expect(reduceDelegations(open, event("delegation.updated", {}))).toBe(open);
    expect(keysForEvent("delegation.updated")).toContainEqual(["openbot", "messages"]);
  });

  it("remembers why a bot's turn failed until its next turn", () => {
    let failures = reduceFailures({}, event("turn.failed", { errorMessage: "Session limit" }));
    expect(failures).toEqual({ bot_a: "Session limit" });
    failures = reduceFailures(failures, event("turn.interrupted", {}, "bot_b"));
    expect(failures.bot_b).toBe("");
    failures = reduceFailures(failures, event("turn.started"));
    expect(failures).toEqual({ bot_b: "" });
  });
});
