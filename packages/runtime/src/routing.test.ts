import { describe, expect, it } from "vitest";
import { resolveRoute } from "./routing.js";

describe("resolveRoute (plan §5 WS2 routing hook)", () => {
  it("always allows a model/effort switch within the same engine, carrying the session over", () => {
    const result = resolveRoute({
      currentEngine: "claude",
      currentSessionId: "sess_1",
      requestedEngine: "claude",
      requestedModel: "opus",
      requestedEffort: "high",
      band: "human",
    });
    expect(result.engine).toBe("claude");
    expect(result.model).toBe("opus");
    expect(result.sessionId).toBe("sess_1");
    expect(result.seededNewSession).toBe(false);
    expect(result.refused).toBeUndefined();
  });

  it("allows an engine switch and seeds a new session when the band is auto", () => {
    const result = resolveRoute({
      currentEngine: "claude",
      currentSessionId: "sess_1",
      requestedEngine: "codex",
      requestedModel: "gpt-5",
      band: "auto",
    });
    expect(result.engine).toBe("codex");
    expect(result.sessionId).toBeUndefined();
    expect(result.seededNewSession).toBe(true);
  });

  it.each(["confirm", "human", undefined] as const)(
    "refuses an engine switch and stays on the current engine when band is %s",
    (band) => {
      const result = resolveRoute({
        currentEngine: "claude",
        currentSessionId: "sess_1",
        requestedEngine: "codex",
        requestedModel: "gpt-5",
        band,
      });
      expect(result.engine).toBe("claude");
      expect(result.sessionId).toBe("sess_1");
      expect(result.seededNewSession).toBe(false);
      expect(result.refused).toBeDefined();
    },
  );

  it("treats no current engine (first turn) as not a switch", () => {
    const result = resolveRoute({ requestedEngine: "claude", requestedModel: "opus" });
    expect(result.engine).toBe("claude");
    expect(result.seededNewSession).toBe(false);
    expect(result.refused).toBeUndefined();
  });
});
