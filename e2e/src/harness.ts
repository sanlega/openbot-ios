import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const serverRoot = dirname(dirname(require.resolve("@openbot/server")));
const serverMain = join(serverRoot, "src", "main.ts");
const tsxCli = join(serverRoot, "node_modules", "tsx", "dist", "cli.mjs");

export interface TestHarness {
  baseUrl: string;
  close: () => Promise<void>;
}

/** Starts `openbot serve` with fakes on a random loopback port. */
export async function startTestHarness(): Promise<TestHarness> {
  const home = await mkdtemp(join(tmpdir(), "openbot-e2e-"));
  const port = 18000 + Math.floor(Math.random() * 1000);
  const env = {
    ...process.env,
    OPENBOT_HOME: home,
    PORT: String(port),
    OPENBOT_FAKE_JEV: "1",
    JEV_API_KEY: "",
  };

  const child: ChildProcess = spawn(process.execPath, [tsxCli, serverMain, "serve"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHarness(baseUrl);

  return {
    baseUrl,
    close: async () => {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
      await rm(home, { recursive: true, force: true });
    },
  };
}

async function waitForHarness(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/harness/status`);
      if (res.ok) {
        const body = (await res.json()) as { connected?: boolean };
        if (body.connected) return;
      }
    } catch {
      // server still booting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Harness did not become ready in time");
}
