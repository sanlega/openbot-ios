import { describe, it, expect } from "vitest";
import { uiReducer, createInitialState, pendingApprovals } from "./reducer.js";
import { buildSeedEvents, SEED_BOTS, SEED_MESSAGES } from "../mock/seed-data.js";
import type { OBEvent } from "@openbot/contracts";

describe("uiReducer", () => {
  it("folds a turn's tool steps and links them to the Bot's reply", () => {
    const ev = (seq: number, type: string, payload: Record<string, unknown>): OBEvent => ({
      id: `evt_${seq}`,
      seq,
      ts: `2026-09-27T10:00:0${seq}.000Z`,
      type: type as OBEvent["type"],
      botId: "bot_code_01",
      threadId: "thr_code",
      turnId: "turn_1",
      payload,
    });
    let state = createInitialState(SEED_BOTS);
    for (const event of [
      ev(1, "turn.started", { engine: "claude", model: "m" }),
      ev(2, "tool.started", { toolName: "Read", toolUseId: "tu_1", input: { file_path: "a.md" } }),
      ev(3, "tool.completed", { toolUseId: "tu_1", output: "ok", isError: false }),
      ev(4, "message.created", { messageId: "msg_reply", text: "done", author: "bot" }),
      ev(5, "turn.completed", { text: "done" }),
    ]) {
      state = uiReducer(state, { type: "event", event });
    }
    const turn = state.turns.get("turn_1");
    expect(turn).toMatchObject({ status: "done", steps: [{ tool: "Read", status: "done" }] });
    expect(state.turnByMessage.get("msg_reply")).toBe("turn_1");

    // The bus does not guarantee order: a tool event may arrive before turn.started.
    let late = createInitialState(SEED_BOTS);
    for (const event of [
      {
        ...ev(2, "tool.started", { toolName: "Read", toolUseId: "tu_1", input: {} }),
        turnId: "t2",
      },
      { ...ev(1, "turn.started", { engine: "claude", model: "m" }), turnId: "t2" },
      { ...ev(3, "turn.completed", {}), turnId: "t2" },
    ]) {
      late = uiReducer(late, { type: "event", event });
    }
    expect(late.turns.get("t2")).toMatchObject({ status: "done", steps: [{ tool: "Read" }] });
  });

  it("shows a hydrated thread oldest first, whatever order the API used", () => {
    const [first, second] = SEED_MESSAGES.filter((m) => m.threadId === SEED_MESSAGES[0]!.threadId);
    const older = { ...first!, id: "m_old", createdAt: "2026-09-27T10:00:00.000Z" };
    const newer = { ...(second ?? first)!, id: "m_new", createdAt: "2026-09-27T11:00:00.000Z" };
    const state = createInitialState(SEED_BOTS, [], [newer, older]);
    expect(state.messagesByThread.get(older.threadId)?.map((m) => m.id)).toEqual([
      "m_old",
      "m_new",
    ]);
  });

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
