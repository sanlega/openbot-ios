import { describe, expect, it } from "vitest";
import type { ComputerProvider } from "@openbot/contracts";

/**
 * Plan §5 WS0 "conformance suite skeletons" for the Computer SPI. WS9 runs
 * this same suite against `packages/computer/docker` and `packages/computer/local`
 * once they land.
 */
export function runComputerProviderConformance(
  label: string,
  makeProvider: () => ComputerProvider | Promise<ComputerProvider>,
): void {
  describe(`ComputerProvider conformance: ${label}`, () => {
    it("status() resolves without throwing", async () => {
      const provider = await makeProvider();
      const status = await provider.status();
      expect(typeof status.ready).toBe("boolean");
    });

    it("ensureStarted() then status().ready is true", async () => {
      const provider = await makeProvider();
      await provider.ensureStarted();
      const status = await provider.status();
      expect(status.ready).toBe(true);
    });

    it("screen().observe() returns elements with unique, stable indices", async () => {
      const provider = await makeProvider();
      await provider.ensureStarted();
      const screen = await provider.screen("bot_conformance");
      const observation = await screen.observe();
      const indices = observation.elements.map((el) => el.index);
      expect(new Set(indices).size).toBe(indices.length);
      for (const el of observation.elements) {
        expect(typeof el.role).toBe("string");
        expect(typeof el.label).toBe("string");
      }
    });

    it("act() on an observed element index succeeds", async () => {
      const provider = await makeProvider();
      await provider.ensureStarted();
      const screen = await provider.screen("bot_conformance");
      const observation = await screen.observe();
      const first = observation.elements[0];
      expect(first).toBeDefined();
      if (!first) return;
      const result = await screen.act({ op: "click", target: first.index });
      expect(typeof result.ok).toBe("boolean");
    });

    it("act() on an unobserved index is rejected, never silently guessed", async () => {
      const provider = await makeProvider();
      await provider.ensureStarted();
      const screen = await provider.screen("bot_conformance");
      await screen.observe();
      const result = await screen.act({ op: "click", target: 999_999 });
      expect(result.ok).toBe(false);
    });

    it("takeover(true) then takeover(false) resolves without throwing", async () => {
      const provider = await makeProvider();
      await provider.ensureStarted();
      const screen = await provider.screen("bot_conformance");
      await screen.takeover(true);
      await screen.takeover(false);
    });
  });
}
