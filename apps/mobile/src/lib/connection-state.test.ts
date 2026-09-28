import { describe, expect, it } from "vitest";
import { advanceEventCursor, connectionLabel, reconnectDelay } from "./connection-state.js";

describe("connection display and retry schedule", () => {
  it("shows explicit reconnect and revoked states", () => {
    expect(connectionLabel({ status: "reconnecting", attempt: 3 })).toBe("Reconnecting…");
    expect(connectionLabel({ status: "revoked" })).toBe("Pairing revoked");
  });

  it("uses capped exponential reconnect delays", () => {
    expect([0, 1, 2, 3, 7].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 30000]);
    expect(reconnectDelay(-1)).toBe(500);
  });

  it("does not advance past out-of-order events and ignores duplicates", () => {
    const pending = new Set<number>();
    let cursor = advanceEventCursor(4, pending, 6);
    expect(cursor).toBe(4);
    cursor = advanceEventCursor(cursor, pending, 6);
    expect(cursor).toBe(4);
    cursor = advanceEventCursor(cursor, pending, 5);
    expect(cursor).toBe(6);
    expect(pending.size).toBe(0);
  });
});
