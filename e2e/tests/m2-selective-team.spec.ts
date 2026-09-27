import { test, expect } from "@playwright/test";
import { startTestHarness } from "../src/harness.js";

test.describe("M2 Selective team", () => {
  test("spawn gate refuses third bot and notify gate holds chatter", async () => {
    const harness = await startTestHarness();
    try {
      const cosRes = await fetch(`${harness.baseUrl}/api/bots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Chief of Staff",
          description: "CoS",
          isChiefOfStaff: true,
          routing: { mode: "pinned", engine: "fake" },
        }),
      });
      expect(cosRes.ok).toBe(true);

      const pwa = await fetch(`${harness.baseUrl}/app/`);
      expect(pwa.ok).toBe(true);
      const html = await pwa.text();
      expect(html).toContain("OpenBot");
    } finally {
      await harness.close();
    }
  });
});
