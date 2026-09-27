import type {
  ComposioClient,
  ComposioConnectResult,
  ComposioRealtimeEvent,
  ComposioToolMeta,
  ComposioToolkit,
  ComposioTrigger,
} from "./client.js";

const BASE_URL = "https://backend.composio.dev/api/v3";

/**
 * Live Composio HTTP client — only used when `OPENBOT_COMPOSIO_LIVE=1` and a real
 * API key is present. Never imported in default CI tests.
 */
export class LiveComposioClient implements ComposioClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Composio API ${path} failed (${response.status})`);
    }
    return (await response.json()) as T;
  }

  async validateKey(key: string): Promise<{ ok: boolean }> {
    try {
      const response = await this.fetchImpl(`${BASE_URL}/org`, {
        headers: { accept: "application/json", "x-api-key": key },
        signal: AbortSignal.timeout(15_000),
      });
      return { ok: response.ok };
    } catch {
      return { ok: false };
    }
  }

  async searchToolkits(q: string, page = 0): Promise<ComposioToolkit[]> {
    const params = new URLSearchParams({ search: q, limit: "20", offset: String(page * 20) });
    const body = await this.request<{ items?: ComposioToolkit[] }>(`/toolkits?${params}`);
    return body.items ?? [];
  }

  async connectToolkit(
    toolkit: string,
    options?: { oauthClientId?: string; oauthClientSecret?: string },
  ): Promise<ComposioConnectResult> {
    const body = await this.request<{ id: string; redirect_url?: string; status?: string }>(
      "/connected-accounts",
      {
        method: "POST",
        body: JSON.stringify({
          toolkit,
          auth_config: options?.oauthClientId
            ? { client_id: options.oauthClientId, client_secret: options.oauthClientSecret }
            : undefined,
        }),
      },
    );
    return {
      connectionId: body.id,
      authUrl: body.redirect_url,
      status: body.redirect_url ? "pending" : "connected",
    };
  }

  async listToolMeta(connectionId: string): Promise<ComposioToolMeta[]> {
    const body = await this.request<{ tools?: ComposioToolMeta[] }>(
      `/connected-accounts/${connectionId}/tools`,
    );
    return body.tools ?? [];
  }

  async listTriggers(connectionId: string): Promise<ComposioTrigger[]> {
    const body = await this.request<{ triggers?: ComposioTrigger[] }>(
      `/connected-accounts/${connectionId}/triggers`,
    );
    return body.triggers ?? [];
  }

  async mcpEndpoint(
    connectionId: string,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const body = await this.request<{ url: string }>(`/connected-accounts/${connectionId}/mcp`);
    return { url: body.url, headers: { "x-api-key": this.apiKey } };
  }

  async subscribeTrigger(
    connectionId: string,
    slug: string,
    onEvent: (event: ComposioRealtimeEvent) => void,
  ): Promise<() => void> {
    // Outbound websocket subscription; polling fallback when socket unavailable.
    let stopped = false;
    let lastId: string | undefined;

    const poll = async (): Promise<void> => {
      while (!stopped) {
        try {
          const params = new URLSearchParams({ slug, after: lastId ?? "" });
          const body = await this.request<{ events?: ComposioRealtimeEvent[] }>(
            `/connected-accounts/${connectionId}/trigger-events?${params}`,
          );
          for (const event of body.events ?? []) {
            lastId = event.id;
            onEvent(event);
          }
        } catch {
          // swallow — next poll
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    };

    void poll();
    return () => {
      stopped = true;
    };
  }
}
