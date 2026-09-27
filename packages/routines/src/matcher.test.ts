import { describe, expect, it } from "vitest";
import { matchesDeterministicFilter, hashPayload } from "./matcher.js";

describe("matcher", () => {
  it("hashPayload is stable", () => {
    expect(hashPayload({ a: 1 })).toBe(hashPayload({ a: 1 }));
  });

  it("matchesDeterministicFilter applies path regex", () => {
    const payload = { action: "opened", repo: "OpenBot" };
    expect(
      matchesDeterministicFilter(payload, [{ path: "action", regex: "^opened$" }]),
    ).toBe(true);
    expect(
      matchesDeterministicFilter(payload, [{ path: "action", regex: "^closed$" }]),
    ).toBe(false);
  });
});
