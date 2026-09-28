import type { Action, ActResult, Observation } from "@openbot/contracts";

/** HTTP control daemon inside `images/desktop` (plan WS9). */
export interface ControlDaemonClient {
  observe(botId: string, display: number): Promise<Observation>;
  act(botId: string, display: number, action: Action): Promise<ActResult>;
  liveView(botId: string): Promise<{ url: string; token: string; expiresAt: string }>;
  health(): Promise<{ ok: boolean }>;
}

export interface ControlDaemonOptions {
  baseUrl: string;
  token?: string;
}

export class HttpControlDaemonClient implements ControlDaemonClient {
  constructor(private readonly options: ControlDaemonOptions) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    return headers;
  }

  async health(): Promise<{ ok: boolean }> {
    const res = await fetch(`${this.options.baseUrl}/health`, { headers: this.headers() });
    return { ok: res.ok };
  }

  async observe(botId: string, display: number): Promise<Observation> {
    const url = new URL(`${this.options.baseUrl}/observe`);
    url.searchParams.set("botId", botId);
    url.searchParams.set("display", String(display));
    const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`control daemon observe failed: ${res.status}`);
    return (await res.json()) as Observation;
  }

  async act(botId: string, display: number, action: Action): Promise<ActResult> {
    const res = await fetch(`${this.options.baseUrl}/act`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ botId, display, action }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`control daemon act failed: ${res.status}`);
    return (await res.json()) as ActResult;
  }

  async liveView(botId: string): Promise<{ url: string; token: string; expiresAt: string }> {
    const url = new URL(`${this.options.baseUrl}/live`);
    url.searchParams.set("botId", botId);
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`control daemon live failed: ${res.status}`);
    return (await res.json()) as { url: string; token: string; expiresAt: string };
  }
}
