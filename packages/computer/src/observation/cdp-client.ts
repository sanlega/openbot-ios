import { createConnection } from "node:net";

interface CdpTarget {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

/** Minimal Chrome DevTools Protocol client (DOM + Accessibility domains). */
export class CdpClient {
  private ws: WebSocket | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly port: number) {}

  async connect(timeoutMs = 30_000): Promise<void> {
    const targets = await this.waitForTargets(timeoutMs);
    const page = targets.find((t) => t.type === "page") ?? targets[0];
    if (!page?.webSocketDebuggerUrl) {
      throw new Error(`no CDP target on port ${this.port}`);
    }
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => resolve();
      this.ws!.onerror = () => reject(new Error("CDP websocket failed"));
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as {
        id?: number;
        error?: { message: string };
        result?: unknown;
      };
      if (!msg.id) return;
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
    };
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Accessibility.enable");
  }

  async close(): Promise<void> {
    this.ws?.close();
    this.ws = undefined;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    })) as { result?: { value?: T } };
    return result.result?.value as T;
  }

  async axTree(): Promise<unknown> {
    return this.send("Accessibility.getFullAXTree");
  }

  async screenshot(): Promise<Buffer> {
    const result = (await this.send("Page.captureScreenshot", { format: "png" })) as {
      data?: string;
    };
    if (!result.data) throw new Error("captureScreenshot returned no data");
    return Buffer.from(result.data, "base64");
  }

  private async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws) throw new Error("CDP not connected");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  private async listTargets(): Promise<Array<CdpTarget & { type?: string }>> {
    const res = await fetch(`http://127.0.0.1:${this.port}/json/list`);
    if (!res.ok) throw new Error(`CDP /json/list failed: ${res.status}`);
    return (await res.json()) as Array<CdpTarget & { type?: string }>;
  }

  private async waitForTargets(timeoutMs: number): Promise<Array<CdpTarget & { type?: string }>> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const targets = await this.listTargets();
        if (targets.length > 0) return targets;
      } catch {
        // Chromium still starting
      }
      await sleep(300);
    }
    throw new Error(`no CDP target on port ${this.port}`);
  }

  /** Wait until CDP port accepts connections (Chromium still starting). */
  static async waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = createConnection({ port, host: "127.0.0.1" }, () => {
            socket.end();
            resolve();
          });
          socket.on("error", reject);
        });
        return;
      } catch {
        await sleep(200);
      }
    }
    throw new Error(`CDP port ${port} not ready within ${timeoutMs}ms`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withCdp<T>(
  port: number,
  fn: (client: CdpClient) => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const client = new CdpClient(port);
  await CdpClient.waitForPort(port, timeoutMs);
  await client.connect(timeoutMs);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}
