import { describe, expect, it } from "vitest";
import {
  DockerUnavailableError,
  dockerDesktopLaunch,
  ensureDockerEngine,
} from "./docker-launcher.js";

/** A clock that only moves when the code sleeps. */
function fakeTime() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe("ensureDockerEngine", () => {
  it("does nothing when the engine already answers", async () => {
    const launched: string[] = [];
    const result = await ensureDockerEngine(async () => undefined, {
      launch: (c) => void launched.push(c),
    });
    expect(result).toEqual({ started: false });
    expect(launched).toEqual([]);
  });

  it("starts Docker Desktop on Windows and waits until it answers", async () => {
    const time = fakeTime();
    const launched: string[] = [];
    let pings = 0;
    const result = await ensureDockerEngine(
      async () => {
        pings += 1;
        if (pings < 4) throw new Error("connect ENOENT //./pipe/docker_engine");
      },
      {
        platform: "win32",
        env: { ProgramFiles: "C:\\Program Files" },
        exists: (p) => p.endsWith("Docker Desktop.exe"),
        launch: (command) => void launched.push(command),
        ...time,
      },
    );
    expect(result).toEqual({ started: true });
    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatch(/Docker Desktop\.exe$/);
  });

  it("starts Docker on macOS with `open -a Docker`", () => {
    expect(
      dockerDesktopLaunch({ platform: "darwin", exists: (p) => p === "/Applications/Docker.app" }),
    ).toEqual({ command: "open", args: ["-a", "Docker"] });
  });

  it("says Docker Desktop isn't installed instead of a socket error", async () => {
    const error = await ensureDockerEngine(
      async () => {
        throw new Error("connect ENOENT //./pipe/docker_engine");
      },
      { platform: "win32", env: {}, exists: () => false },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DockerUnavailableError);
    expect((error as DockerUnavailableError).reason).toBe("not_installed");
    expect((error as Error).message).toMatch(/isn't installed.*docker\.com/);
    expect((error as Error).message).not.toMatch(/ENOENT/);
  });

  it("gives up with a clear message if Docker never comes up", async () => {
    const error = await ensureDockerEngine(
      async () => {
        throw new Error("still down");
      },
      {
        platform: "darwin",
        exists: () => true,
        launch: () => undefined,
        timeoutMs: 10_000,
        ...fakeTime(),
      },
    ).catch((e: unknown) => e);
    expect((error as DockerUnavailableError).reason).toBe("start_timeout");
    expect((error as Error).message).toMatch(/didn't finish starting/);
  });

  it("on Linux, tells the person to start the service", async () => {
    const error = await ensureDockerEngine(
      async () => {
        throw new Error("connect ENOENT /var/run/docker.sock");
      },
      { platform: "linux" },
    ).catch((e: unknown) => e);
    expect((error as DockerUnavailableError).reason).toBe("not_running");
    expect((error as Error).message).toMatch(/systemctl start docker/);
  });
});
