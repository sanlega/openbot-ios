import { describe, it, expect } from "vitest";
import { uiReducer, createInitialState, pendingApprovals } from "./reducer.js";
import { buildSeedEvents, SEED_BOTS, SEED_MESSAGES } from "../mock/seed-data.js";
import type { OBEvent } from "@openbot/contracts";

describe("uiReducer", () => {
  it("rebuilds streamed text in order even when chunks arrive out of order", () => {
    const delta = (seq: number, text: string): OBEvent => ({
      id: `evt_d${seq}`,
      seq,
      ts: "2026-09-27T10:00:00.000Z",
      type: "message.delta",
      botId: "bot_code_01",
      turnId: "turn_x",
      payload: { text },
    });
    let state = createInitialState(SEED_BOTS);
    for (const event of [delta(3, "world"), delta(1, "Hello"), delta(2, ", ")]) {
      state = uiReducer(state, { type: "event", event });
    }
    expect(state.turns.get("turn_x")?.text).toBe("Hello, world");
  });

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

  it("keeps the engine failure reason so the chat can explain why the Bot stopped", () => {
    const started: OBEvent = {
      id: "evt_started",
      seq: 1,
      ts: "2026-09-27T10:00:00.000Z",
      type: "turn.started",
      botId: "bot_code_01",
      threadId: "thr_code",
      turnId: "turn_failed",
      payload: { engine: "claude", model: "opus" },
    };
    const failed: OBEvent = {
      id: "evt_failed",
      seq: 2,
      ts: "2026-09-27T10:00:02.000Z",
      type: "turn.failed",
      botId: "bot_code_01",
      threadId: "thr_code",
      turnId: "turn_failed",
      payload: { errorMessage: "You've hit your session limit · resets at 11:30pm" },
    };
    const state = uiReducer(
      uiReducer(createInitialState(SEED_BOTS), { type: "event", event: started }),
      { type: "event", event: failed },
    );
    expect(state.turns.get("turn_failed")).toMatchObject({
      status: "failed",
      errorMessage: "You've hit your session limit · resets at 11:30pm",
    });
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

  it("follows a worker's open delegation to the thread the user is in, and drops it when done", () => {
    let state = createInitialState();
    const update = (seq: number, delegationState: string): OBEvent => ({
      id: `evt_dlg_${seq}`,
      seq,
      ts: new Date().toISOString(),
      type: "delegation.updated",
      botId: "bot_worker",
      payload: {
        delegation: {
          id: "dlg_1",
          assigneeBotId: "bot_worker",
          ownerThreadId: "thr_chief",
          state: delegationState,
        },
      },
    });
    state = uiReducer(state, { type: "event", event: update(1, "working") });
    expect(state.delegations.get("dlg_1")).toEqual({
      assigneeBotId: "bot_worker",
      ownerThreadId: "thr_chief",
      state: "working",
    });
    state = uiReducer(state, { type: "event", event: update(2, "completed") });
    expect(state.delegations.has("dlg_1")).toBe(false);
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

describe("computer steps in the chat", () => {
  it("adds each step under the running computer task, once, in order", () => {
    const ev = (
      seq: number,
      type: string,
      payload: Record<string, unknown>,
      turn = true,
    ): OBEvent => ({
      id: `evt_${seq}`,
      seq,
      ts: `2026-09-27T10:00:0${seq}.000Z`,
      type: type as OBEvent["type"],
      botId: "bot_code_01",
      ...(turn ? { threadId: "thr_code", turnId: "turn_c" } : {}),
      payload,
    });
    const step = (n: number, extra: Record<string, unknown>) => ({
      taskId: "ctask_1",
      step: { step: n, at: "2026-09-27T10:00:00.000Z", ...extra },
    });
    let state = createInitialState(SEED_BOTS);
    for (const event of [
      ev(1, "turn.started", { engine: "claude", model: "m" }),
      ev(2, "tool.started", {
        toolName: "mcp__openbot__computer_task",
        toolUseId: "tu_c",
        input: { goal: "Search YouTube" },
      }),
      // Computer events carry no turn id, arrive duplicated and out of order.
      ev(4, "computer.step", step(2, { op: "type", target: "Search", outcome: "executed" }), false),
      ev(
        3,
        "computer.step",
        step(1, { op: "click", target: "Reject all", outcome: "executed" }),
        false,
      ),
      ev(5, "computer.step", step(2, { op: "type", target: "Search", outcome: "executed" }), false),
    ]) {
      state = uiReducer(state, { type: "event", event });
    }
    const live = state.turns.get("turn_c")?.steps[0]?.live;
    expect(live?.map((l) => l.text)).toEqual(["Clicked “Reject all”", "Typed into “Search”"]);
  });
});

describe("computer task status", () => {
  it("remembers a task still waiting for text after the turn ends", () => {
    let state = createInitialState(SEED_BOTS);
    const base = { botId: "bot_code_01", threadId: "thr_code", turnId: "turn_w" };
    for (const event of [
      {
        ...base,
        id: "w1",
        seq: 1,
        ts: "2026-09-27T10:00:00.000Z",
        type: "turn.started",
        payload: {},
      },
      {
        ...base,
        id: "w2",
        seq: 2,
        ts: "2026-09-27T10:00:01.000Z",
        type: "tool.started",
        payload: { toolName: "mcp__openbot__computer_task", toolUseId: "tu_w", input: {} },
      },
      {
        id: "w3",
        seq: 3,
        ts: "2026-09-27T10:00:02.000Z",
        type: "computer.task_started",
        botId: "bot_code_01",
        payload: { taskId: "ctask_1", status: "needs_input", needsText: "Subject" },
      },
      {
        ...base,
        id: "w4",
        seq: 4,
        ts: "2026-09-27T10:00:03.000Z",
        type: "turn.completed",
        payload: {},
      },
    ] as OBEvent[]) {
      state = uiReducer(state, { type: "event", event });
    }
    const turn = state.turns.get("turn_w");
    expect(turn?.status).toBe("done");
    expect(turn?.steps[0]?.taskStatus).toBe("needs_input");
  });
});

describe("interrupted turns", () => {
  it("keep the reason they were interrupted", () => {
    let state = createInitialState(SEED_BOTS);
    const base = { botId: "bot_code_01", threadId: "thr_code", turnId: "turn_i" };
    for (const event of [
      {
        ...base,
        id: "e1",
        seq: 1,
        ts: "2026-09-27T10:00:00.000Z",
        type: "turn.started",
        payload: {},
      },
      {
        ...base,
        id: "e2",
        seq: 2,
        ts: "2026-09-27T10:01:00.000Z",
        type: "turn.interrupted",
        payload: { errorMessage: "OpenBot restarted before this turn finished." },
      },
    ] as OBEvent[]) {
      state = uiReducer(state, { type: "event", event });
    }
    expect(state.turns.get("turn_i")?.errorMessage).toBe(
      "OpenBot restarted before this turn finished.",
    );
  });
});

describe("seed messages", () => {
  it("includes held delivery for activity filter", () => {
    const held = SEED_MESSAGES.filter((m) => m.delivery === "held");
    expect(held.length).toBeGreaterThan(0);
  });
});
