import { describe, expect, it } from "vitest";
import { startTestHarness } from "./harness.js";

describe("@openbot/e2e", () => {
  it("starts a wired harness", async () => {
    const harness = await startTestHarness();
    const res = await fetch(`${harness.baseUrl}/api/health`);
    expect(res.ok).toBe(true);
    await harness.close();
  });
});
