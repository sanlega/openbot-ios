import { describe, expect, it } from "vitest";
import { TailscaleManager, type ExecFn } from "./tailscale-manager.js";

describe("TailscaleManager", () => {
  it("detects a faked tailscale CLI", async () => {
    const exec: ExecFn = async (command, args) => {
      expect(command).toBe("tailscale");
      if (args[0] === "version") return { stdout: "tailscale version 1.76.0\n", stderr: "" };
      throw new Error("unexpected");
    };
    const manager = new TailscaleManager(exec);
    await expect(manager.detect()).resolves.toEqual({ ok: true, version: "1.76.0" });
  });

  it("enables serve against loopback and returns HTTPS URLs", async () => {
    const exec: ExecFn = async (_command, args) => {
      if (args[0] === "version") return { stdout: "tailscale version 1.76.0\n", stderr: "" };
      if (args[0] === "serve" && args[1] === "--bg") return { stdout: "", stderr: "" };
      if (args[0] === "serve" && args[1] === "status") {
        return {
          stdout: JSON.stringify({
            TCP: { 443: { Web: { URLs: ["https://desk.tailnet.ts.net"] } } },
          }),
          stderr: "",
        };
      }
      if (args[0] === "status") {
        return {
          stdout: JSON.stringify({
            BackendState: "Running",
            Self: { TailscaleIPs: ["100.64.0.2"] },
          }),
          stderr: "",
        };
      }
      throw new Error(`unexpected ${args.join(" ")}`);
    };
    const manager = new TailscaleManager(exec);
    const result = await manager.enable(4577);
    expect(result).toEqual({ ok: true, urls: ["https://desk.tailnet.ts.net"] });
  });
});
