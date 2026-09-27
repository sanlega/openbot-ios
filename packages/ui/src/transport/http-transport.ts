import type {
  Transport,
  TransportMode,
  TransportOptions,
  WsCommand,
  WsInbound,
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
    const res = await fetch(joinUrl(this.baseUrl, path), {
      ...init,
      method: "GET",
      headers: this.headers(init?.headers),
    });
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    const res = await fetch(joinUrl(this.baseUrl, path), {
      ...init,
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
        ...init?.headers,
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`POST ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  connectWebSocket(
    onMessage: (msg: WsInbound) => void,
    onClose?: () => void,
  ): { subscribe(since: number): void; send(command: WsCommand): void; close(): void } {
    const wsUrl = joinUrl(this.baseUrl, "/api/ws").replace(/^http/, "ws");
    const ws = new WebSocket(wsUrl);

    ws.addEventListener("message", (ev) => {
      onMessage(JSON.parse(String(ev.data)) as WsInbound);
    });
    ws.addEventListener("close", () => onClose?.());

    return {
      subscribe(since: number) {
        ws.addEventListener("open", () => {
          ws.send(JSON.stringify({ subscribe: true, since }));
        });
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ subscribe: true, since }));
        }
      },
      send(command: WsCommand) {
        ws.send(JSON.stringify(command));
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
