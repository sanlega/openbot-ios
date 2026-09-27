import { describe, expect, it } from "vitest";
import { FakeClock } from "./fake-clock.js";

describe("FakeClock", () => {
  it("starts at the given time and does not advance on its own", () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("advance() moves time forward by exactly the given amount", () => {
    const clock = new FakeClock(0);
    clock.advance(5000);
    expect(clock.now().getTime()).toBe(5000);
  });

  it("fires a timer once its due time is reached by advance()", () => {
    const clock = new FakeClock(0);
    let fired = false;
    clock.setTimeout(() => {
      fired = true;
    }, 1000);

    clock.advance(500);
    expect(fired).toBe(false);

    clock.advance(500);
    expect(fired).toBe(true);
  });

  it("fires timers in due-time order within a single advance()", () => {
    const clock = new FakeClock(0);
    const order: string[] = [];
    clock.setTimeout(() => order.push("second"), 2000);
    clock.setTimeout(() => order.push("first"), 1000);

    clock.advance(3000);
    expect(order).toEqual(["first", "second"]);
  });

  it("clearTimeout() prevents a scheduled timer from firing", () => {
    const clock = new FakeClock(0);
    let fired = false;
    const id = clock.setTimeout(() => {
      fired = true;
    }, 1000);
    clock.clearTimeout(id);

    clock.advance(2000);
    expect(fired).toBe(false);
  });
});
