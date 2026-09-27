import { describe, it, expect } from "vitest";
import { uiReducer, createInitialState, pendingApprovals } from "./reducer.js";
import { buildSeedEvents, SEED_BOTS, SEED_MESSAGES } from "../mock/seed-data.js";
import type { OBEvent } from "@openbot/contracts";

describe("uiReducer", () => {
  it("dedupes events by id on reconnect", () => {
    let state = createInitialState();
    const event = buildSeedEvents()[0]!;
    state = uiReducer(state, { type: "event", event });
    const again = uiReducer(state, { type: "event", event });
    expect(again.seenEventIds.size).toBe(1);
    expect(again.lastSeq).toBe(event.seq);
  });

  it("tracks pending approvals", () => {
    let state = createInitialState();
    const event: OBEvent = {
      id: "evt_test",
      seq: 10,
      ts: new Date().toISOString(),
      type: "approval.requested",
      botId: "bot_code_01",
      payload: {
        approvalId: "apr_test",
        kind: "tool",
        summary: "Test approval",
        detail: "details",
      },
    };
    state = uiReducer(state, { type: "event", event });
    expect(pendingApprovals(state)).toHaveLength(1);
  });

  it("applies route.decided", () => {
    let state = createInitialState(SEED_BOTS);
    const event: OBEvent = {
      id: "evt_route",
      seq: 5,
      ts: new Date().toISOString(),
      type: "route.decided",
      botId: "bot_cos_01",
      payload: { engine: "claude", model: "opus", confidence: 0.95 },
    };
    state = uiReducer(state, { type: "event", event });
    expect(state.routes.get("bot_cos_01")?.model).toBe("opus");
  });
});

describe("seed messages", () => {
  it("includes held delivery for activity filter", () => {
    const held = SEED_MESSAGES.filter((m) => m.delivery === "held");
    expect(held.length).toBeGreaterThan(0);
  });
});
