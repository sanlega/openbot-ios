import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { CloudflareManager, hostnameFromTunnelLog, type SpawnFn } from "./cloudflare-manager.js";

describe("CloudflareManager", () => {
  it("validates tunnel tokens", async () => {
    const manager = new CloudflareManager(() => ({}) as ChildProcess);
    await expect(manager.validateToken("")).resolves.toEqual({
      ok: false,
      reason: "tunnel token required",
    });
    await expect(manager.validateToken("a.b.c")).resolves.toEqual({ ok: true });
    const real = Buffer.from(JSON.stringify({ a: "acct", t: "tunnel", s: "secret" })).toString(
      "base64",
    );
    await expect(manager.validateToken(real)).resolves.toEqual({ ok: true });
    await expect(manager.validateToken(`cloudflared service install ${real}`)).resolves.toEqual({
      ok: true,
    });
    await expect(manager.validateToken("not-a-token")).resolves.toMatchObject({ ok: false });
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
          Buffer.from(
            'INF Updated to new configuration config="{\\"ingress\\":[{\\"hostname\\":\\"phone.example.com\\",\\"service\\":\\"http://localhost:4577\\"},{\\"service\\":\\"http_status:404\\"}]}" version=3\n',
          ),
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

  it("reads the public hostname from cloudflared's logs, ignoring unrelated URLs", () => {
    const config =
      'Updated to new configuration config="{\\"ingress\\":[{\\"hostname\\":\\"a.example.com\\",\\"service\\":\\"http://localhost:4577\\"}]}"';
    expect(hostnameFromTunnelLog(config)).toBe("a.example.com");
    expect(hostnameFromTunnelLog("Your quick Tunnel: https://foo-bar.trycloudflare.com")).toBe(
      "foo-bar.trycloudflare.com",
    );
    expect(hostnameFromTunnelLog("ERR failed https://api.cloudflare.com/v4")).toBeUndefined();
  });

  it("prefers the owner-entered hostname over a detected one", () => {
    const manager = new CloudflareManager();
    manager.setHostname("detected.example.com");
    expect(manager.status().hostname).toBe("detected.example.com");
    manager.setManualHostname("mine.example.com");
    expect(manager.status().hostname).toBe("mine.example.com");
    manager.setManualHostname(undefined);
    expect(manager.status().hostname).toBe("detected.example.com");
  });
});
