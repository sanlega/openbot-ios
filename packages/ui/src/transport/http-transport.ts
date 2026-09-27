import type {
  Transport,
  TransportMode,
  TransportOptions,
  WsCommand,
  WsInbound,
  WsOutbound,
} from "./types.js";

function joinUrl(base: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base.replace(/\/$/, "")}${normalized}`;
}

/** HTTP + WebSocket client for the Client API (plan §4.7). */
export class HttpTransport implements Transport {
  readonly mode: TransportMode;
  readonly baseUrl: string;
  private readonly deviceToken?: string;

  constructor(options: TransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.mode = options.mode ?? "local";
    this.deviceToken = options.deviceToken;
  }

  private headers(extra?: HeadersInit): HeadersInit {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.deviceToken) {
      headers.Authorization = `Bearer ${this.deviceToken}`;
    }
    return { ...headers, ...extra };
  }

  async get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>("GET", path, undefined, init);
  }

  async post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>("POST", path, body, init);
  }

  async patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>("PATCH", path, body, init);
  }

  async put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>("PUT", path, body, init);
  }

  async delete<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>("DELETE", path, undefined, init);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const res = await fetch(joinUrl(this.baseUrl, path), {
      ...init,
      method,
      headers: this.headers({
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`${method} ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  connectWebSocket(
    onMessage: (msg: WsInbound) => void,
    onClose?: () => void,
    onOpen?: () => void,
  ): { subscribe(since: number): void; send(command: WsCommand): void; close(): void } {
    const wsUrl = joinUrl(this.baseUrl, "/api/ws").replace(/^http/, "ws");
    const ws = new WebSocket(wsUrl);

    ws.addEventListener("message", (ev) => {
      onMessage(JSON.parse(String(ev.data)) as WsInbound);
    });
    ws.addEventListener("close", () => onClose?.());

    // Frames sent before the socket opens are queued, not dropped.
    const pending: string[] = [];
    const sendFrame = (frame: WsOutbound) => {
      const text = JSON.stringify(frame);
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
      else pending.push(text);
    };
    ws.addEventListener("open", () => {
      for (const text of pending.splice(0)) ws.send(text);
      onOpen?.();
    });

    return {
      subscribe(since: number) {
        sendFrame({ type: "subscribe", since });
      },
      send(command: WsCommand) {
        sendFrame({ type: "command", ...command });
      },
      close() {
        if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      },
    };
  }

  async close(): Promise<void> {
    /* no persistent resources for HTTP-only usage */
  }
}

export function createTransport(options: TransportOptions): Transport {
  return new HttpTransport(options);
}
