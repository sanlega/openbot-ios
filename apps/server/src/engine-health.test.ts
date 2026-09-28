import { describe, expect, it } from "vitest";
import { EngineHealth, isOutOfService, resetTimeFrom } from "./engine-health.js";

describe("engine health", () => {
  it("recognizes quota and login failures, not ordinary task errors", () => {
    expect(isOutOfService("You've hit your session limit · resets 11:30pm")).toBe(true);
    expect(isOutOfService("Rate limit exceeded (429)")).toBe(true);
    expect(isOutOfService("authentication_failed")).toBe(true);
    expect(isOutOfService("TypeError: cannot read properties of undefined")).toBe(false);
    expect(isOutOfService(undefined)).toBe(false);
  });

  it("reads the reset time from the engine's message", () => {
    const now = new Date(2026, 8, 27, 22, 40);
    expect(resetTimeFrom("resets 11:30pm", now)?.getHours()).toBe(23);
    const tomorrow = resetTimeFrom("resets 9am", now)!;
    expect([tomorrow.getDate(), tomorrow.getHours()]).toEqual([28, 9]);
    expect(resetTimeFrom("no time here", now)).toBeUndefined();
  });

  it("routes around an engine until it recovers, but never to nothing", () => {
    let now = new Date(2026, 8, 27, 22, 40);
    const health = new EngineHealth(() => now);
    health.markOutOfService("claude", "session limit · resets 11:30pm");
    expect(health.filter(["claude", "codex"])).toEqual(["codex"]);
    expect(health.filter(["claude"])).toEqual(["claude"]);
    now = new Date(2026, 8, 27, 23, 31);
    expect(health.filter(["claude", "codex"])).toEqual(["claude", "codex"]);
  });
});
