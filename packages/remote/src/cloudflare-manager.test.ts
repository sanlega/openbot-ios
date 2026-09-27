import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { CloudflareManager, type SpawnFn } from "./cloudflare-manager.js";

describe("CloudflareManager", () => {
  it("validates tunnel tokens", async () => {
    const manager = new CloudflareManager(() => ({}) as ChildProcess);
    await expect(manager.validateToken("")).resolves.toEqual({
      ok: false,
      reason: "tunnel token required",
    });
    await expect(manager.validateToken("a.b.c")).resolves.toEqual({ ok: true });
  });

  it("supervises a faked cloudflared child process", async () => {
    const spawnFn: SpawnFn = () => {
      const child = new EventEmitter() as ChildProcess;
      child.stdout = new EventEmitter() as ChildProcess["stdout"];
      child.stderr = new EventEmitter() as ChildProcess["stderr"];
      child.kill = () => true;
      Object.defineProperty(child, "killed", { value: false });
      queueMicrotask(() => {
        child.stdout?.emit(
          "data",
          Buffer.from("INF Registered tunnel connection https://phone.example.com\n"),
        );
        child.emit("spawn");
      });
      return child;
    };
    const manager = new CloudflareManager(spawnFn);
    const result = await manager.start("eyJhIjoiYiJ9.abc.sig");
    expect(result.ok).toBe(true);
    expect(result.hostname).toBe("phone.example.com");
    expect(result.accessWarning).toMatch(/Access policy not detected/);
  });
});
