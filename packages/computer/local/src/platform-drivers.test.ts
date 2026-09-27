import { describe, expect, it } from "vitest";
import { MemoryLocalDriver } from "./driver-types.js";
import { LinuxLocalDriver } from "./linux-driver.js";
import { DarwinLocalDriver } from "./darwin-driver.js";
import { Win32LocalDriver } from "./win32-driver.js";
import { createLocalDriver } from "./driver.js";
import type { ShellRunner } from "./driver-types.js";

function mockShell(responses: Record<string, { code: number; stdout: string }>): ShellRunner {
  return {
    run: async (cmd, args) => {
      const key = [cmd, ...args].join(" ");
      const hit = Object.entries(responses).find(([pattern]) => key.includes(pattern));
      if (hit) return { ...hit[1], stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

describe("platform local drivers", () => {
  it("LinuxLocalDriver maps xdotool windows to elements", async () => {
    const shell = mockShell({
      search: { code: 0, stdout: "111\n222\n" },
      "getwindowname 111": { code: 0, stdout: "Terminal" },
      "getwindowname 222": { code: 0, stdout: "Browser" },
    });
    const driver = new LinuxLocalDriver(shell);
    const observation = await driver.observe();
    expect(observation.elements.length).toBe(2);
    expect(observation.elements[0]?.label).toBe("Terminal");
  });

  it("DarwinLocalDriver parses osascript output", async () => {
    const shell = mockShell({
      osascript: {
        code: 0,
        stdout: "Safari\nAXButton|OK\nAXTextField|Search",
      },
    });
    const driver = new DarwinLocalDriver(shell);
    const observation = await driver.observe();
    expect(observation.title).toBe("Safari");
    expect(observation.elements.length).toBeGreaterThan(0);
  });

  it("Win32LocalDriver parses PowerShell UIA output", async () => {
    const shell = mockShell({
      powershell: { code: 0, stdout: "ControlType.Button|OK\nControlType.Edit|Search" },
    });
    const driver = new Win32LocalDriver(shell);
    const observation = await driver.observe();
    expect(observation.elements[0]?.label).toBe("OK");
  });

  it("createLocalDriver returns memory driver on unsupported platform", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "freebsd" });
    const driver = createLocalDriver();
    expect(driver).toBeInstanceOf(MemoryLocalDriver);
    Object.defineProperty(process, "platform", { value: original });
  });
});
