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

  /** The tab this client reads and drives. */
  targetId: string | undefined;

  async connect(timeoutMs = 30_000): Promise<void> {
    const targets = await this.waitForTargets(timeoutMs);
    const page = targets.find((t) => t.type === "page") ?? targets[0];
    if (!page?.webSocketDebuggerUrl) {
      throw new Error(`no CDP target on port ${this.port}`);
    }
    this.targetId = page.id;
    // Bring that tab to the front, so what OpenBot reads is what the screen shows.
    await fetch(`http://127.0.0.1:${this.port}/json/activate/${page.id}`).catch(() => undefined);
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

  /** A real mouse click at viewport coordinates (CSS pixels), wherever the window is. */
  async clickAt(x: number, y: number): Promise<void> {
    const base = { x, y, button: "left", clickCount: 1 };
    await this.send("Input.dispatchMouseEvent", { ...base, type: "mouseMoved" });
    await this.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
    await this.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
  }

  /** Presses a key in the page (Enter, Escape, Tab), wherever window focus is. */
  async pressKey(key: string): Promise<void> {
    const codes: Record<string, number> = { Enter: 13, Escape: 27, Tab: 9 };
    const code = codes[key] ?? 0;
    const base = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
    await this.send("Input.dispatchKeyEvent", {
      ...base,
      type: "keyDown",
      ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
    });
    await this.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  }

  /** Types into the focused field, replacing what it held. */
  async replaceFocusedText(text: string): Promise<void> {
    await this.evaluate(
      "(() => { const el = document.activeElement; if (el && typeof el.select === 'function') el.select(); })()",
    );
    await this.send("Input.insertText", { text });
  }

  /** Loads `url` in this tab (not a new one) and waits for the page to load. */
  async navigate(url: string, timeoutMs = 15_000): Promise<void> {
    await this.send("Page.navigate", { url });
    const started = Date.now();
    await sleep(200);
    while (Date.now() - started < timeoutMs) {
      const state = await this.evaluate<string>("document.readyState").catch(() => undefined);
      if (state === "interactive" || state === "complete") return;
      await sleep(200);
    }
  }

  /** Closes every other page tab, so the browser keeps just the one being driven. */
  async closeOtherTabs(): Promise<void> {
    const targets = await this.listTargets().catch(() => []);
    for (const t of targets) {
      if (t.type === "page" && t.id !== this.targetId) {
        await fetch(`http://127.0.0.1:${this.port}/json/close/${t.id}`).catch(() => undefined);
      }
    }
  }

  /** Every cookie of this browser (all sites). */
  async getAllCookies(): Promise<Array<Record<string, unknown>>> {
    const result = (await this.send("Network.getAllCookies")) as {
      cookies?: Array<Record<string, unknown>>;
    };
    return result.cookies ?? [];
  }

  async setCookies(cookies: Array<Record<string, unknown>>): Promise<void> {
    await this.send("Network.setCookies", { cookies });
  }

  async deleteCookies(
    cookies: Array<{ name: string; domain: string; path: string }>,
  ): Promise<void> {
    for (const c of cookies) await this.send("Network.deleteCookies", c);
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
