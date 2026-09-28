import { test, expect } from "@playwright/test";
import { api, startTestHarness } from "../src/harness.js";

interface LanState {
  enabled: boolean;
  active: boolean;
  restartRequired: boolean;
}

test.describe("Phones on this Wi-Fi", () => {
  test("turning it on takes effect after a restart; pairing then offers the LAN address", async () => {
    const first = await startTestHarness();
    let harness = first;
    try {
      const off = await api<LanState>(harness, "/api/remote/lan");
      expect(off.body).toMatchObject({ enabled: false, active: false });

      const on = await api<LanState>(harness, "/api/remote/lan", {
        method: "PUT",
        body: { enabled: true },
      });
      expect(on.body).toMatchObject({ enabled: true, active: false, restartRequired: true });

      await harness.stop();
      harness = await startTestHarness({ home: first.home });
      const after = await api<LanState & { addresses: string[] }>(harness, "/api/remote/lan");
      expect(after.body).toMatchObject({ enabled: true, active: true, restartRequired: false });

      const qr = await api<{ urls: string[] }>(harness, "/api/devices/pair/qr", { body: {} });
      if (after.body.addresses.length > 0) {
        expect(qr.body.urls[0]).toBe(after.body.addresses[0]);
      }
    } finally {
      await harness.stop();
      await first.close();
    }
  });
});
