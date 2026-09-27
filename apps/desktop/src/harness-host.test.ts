import { describe, expect, it, vi } from "vitest";
import { HarnessHost } from "./harness-host.js";

describe("HarnessHost", () => {
  it("restarts after an unexpected exit", async () => {
    const fork = vi.fn();
    const child = {
      pid: 42,
      listeners: new Map<string, (...args: unknown[]) => void>(),
      on(event: string, listener: (...args: unknown[]) => void) {
        this.listeners.set(event, listener);
      },
      kill: vi.fn(),
    };
    fork.mockReturnValue(child);

    const host = new HarnessHost({
      port: 4577,
      openbotHome: "/tmp/openbot",
      fork: { fork },
      serverEntryPath: "/tmp/server-main.js",
      maxRestartDelayMs: 1000,
    });

    host.start();
    child.listeners.get("spawn")?.();
    child.listeners.get("exit")?.(1);

    await vi.waitFor(() => expect(fork).toHaveBeenCalledTimes(2), { timeout: 3000 });
    host.stop();
  });

  it("does not restart after an intentional stop", async () => {
    const fork = vi.fn();
    const child = {
      listeners: new Map<string, (...args: unknown[]) => void>(),
      on(event: string, listener: (...args: unknown[]) => void) {
        this.listeners.set(event, listener);
      },
      kill: vi.fn(),
    };
    fork.mockReturnValue(child);

    const host = new HarnessHost({
      port: 4577,
      openbotHome: "/tmp/openbot",
      fork: { fork },
      serverEntryPath: "/tmp/server-main.js",
    });

    host.start();
    host.stop();
    child.listeners.get("exit")?.(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(fork).toHaveBeenCalledTimes(1);
  });
});
