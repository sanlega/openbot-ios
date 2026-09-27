import { describe, expect, it } from "vitest";
import { runComputerProviderConformance } from "@openbot/testkit";
import { MemoryLocalDriver } from "./driver.js";
import { LocalProvider } from "./local-provider.js";

runComputerProviderConformance(
  "memory driver",
  () => new LocalProvider({ driver: new MemoryLocalDriver(), askEveryTime: false }),
);

describe("LocalProvider", () => {
  it("asks before every action by default", async () => {
    const approvals: string[] = [];
    const driver = new MemoryLocalDriver();
    const provider = new LocalProvider({
      driver,
      approvalHandler: async ({ action }) => {
        approvals.push(action.op);
        return "allow";
      },
    });

    await provider.ensureStarted();
    const screen = await provider.screen("bot_local");
    const observation = await screen.observe();
    await screen.act({ op: "click", target: observation.elements[0]!.index });

    expect(approvals).toEqual(["click"]);
    expect(driver.actions).toHaveLength(1);
  });

  it("denies when approval handler returns deny", async () => {
    const provider = new LocalProvider({
      driver: new MemoryLocalDriver(),
      approvalHandler: async () => "deny",
    });
    await provider.ensureStarted();
    const screen = await provider.screen("bot_local");
    const observation = await screen.observe();
    const result = await screen.act({ op: "click", target: observation.elements[0]!.index });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/denied/i);
  });

  it("rejects unobserved indices", async () => {
    const provider = new LocalProvider({
      driver: new MemoryLocalDriver(),
      askEveryTime: false,
    });
    await provider.ensureStarted();
    const screen = await provider.screen("bot_local");
    await screen.observe();
    const result = await screen.act({ op: "click", target: 999 });
    expect(result.ok).toBe(false);
  });
});

describe("detectLocalPlatform", () => {
  it("returns the current platform on linux CI", async () => {
    const { detectLocalPlatform } = await import("./driver.js");
    expect(["linux", "darwin", "win32"]).toContain(detectLocalPlatform());
  });
});
