import { describe, expect, it } from "vitest";
import { parseDeepLink, threadDeepLink } from "./deep-link.js";

describe("parseDeepLink", () => {
  it("parses thread links", () => {
    expect(parseDeepLink("openbot://thread/thr_abc123")).toEqual({
      kind: "thread",
      threadId: "thr_abc123",
    });
  });

  it("parses setup and home links", () => {
    expect(parseDeepLink("openbot://setup")).toEqual({ kind: "setup" });
    expect(parseDeepLink("openbot://home")).toEqual({ kind: "home" });
    expect(parseDeepLink("openbot://")).toEqual({ kind: "home" });
  });

  it("rejects unknown links", () => {
    expect(parseDeepLink("https://example.com")).toBeNull();
  });
});

describe("threadDeepLink", () => {
  it("builds thread URLs", () => {
    expect(threadDeepLink("thr_x")).toBe("openbot://thread/thr_x");
  });
});
