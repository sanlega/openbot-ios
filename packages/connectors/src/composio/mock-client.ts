import type {
  ComposioClient,
  ComposioConnectResult,
  ComposioRealtimeEvent,
  ComposioToolMeta,
  ComposioToolkit,
  ComposioTrigger,
} from "./client.js";

export interface MockComposioState {
  toolkits?: ComposioToolkit[];
  toolMeta?: Record<string, ComposioToolMeta[]>;
  triggers?: Record<string, ComposioTrigger[]>;
  /** Toolkit slugs that require OAuth even when a redirect URI is supplied. */
  oauthToolkits?: string[];
  /** toolkit -> external OAuth page URL (optional; callback is exercised directly in tests). */
  pendingAuth?: Record<string, string>;
}

/**
 * Scriptable Composio stand-in for CI. Supports toolkit search, OAuth pending flow,
 * tool metadata, and outbound trigger subscriptions (no inbound port).
 */
export class MockComposioClient implements ComposioClient {
  readonly connections = new Map<string, { toolkit: string; status: "connected" | "pending" }>();
  private readonly subscriptions = new Map<string, Set<(event: ComposioRealtimeEvent) => void>>();
  private connectionSeq = 0;

  constructor(
    private readonly apiKey: string,
    private state: MockComposioState = {},
  ) {}

  async validateKey(key: string): Promise<{ ok: boolean }> {
    return { ok: key === this.apiKey && key.length >= 8 };
  }

  async searchToolkits(q: string): Promise<ComposioToolkit[]> {
    const apps = this.state.toolkits ?? [
      { slug: "github", name: "GitHub", description: "GitHub toolkit" },
      { slug: "gmail", name: "Gmail", description: "Gmail toolkit" },
    ];
    const needle = q.trim().toLowerCase();
    if (!needle) return apps;
    return apps.filter(
      (t) =>
        t.slug.includes(needle) ||
        t.name.toLowerCase().includes(needle) ||
        t.description?.toLowerCase().includes(needle),
    );
  }

  async connectToolkit(
    toolkit: string,
    options?: {
      oauthClientId?: string;
      oauthClientSecret?: string;
      redirectUri?: string;
      state?: string;
    },
  ): Promise<ComposioConnectResult> {
    const connectionId = `composio_conn_${++this.connectionSeq}`;
    const needsOAuth = Boolean(
      options?.redirectUri &&
      (this.state.oauthToolkits?.includes(toolkit) || this.state.pendingAuth?.[toolkit]),
    );

    if (needsOAuth) {
      this.connections.set(connectionId, { toolkit, status: "pending" });
      const external =
        this.state.pendingAuth?.[toolkit] ??
        `https://mock.composio.dev/oauth/${toolkit}?redirect_uri=${encodeURIComponent(options!.redirectUri!)}`;
      return { connectionId, authUrl: external, status: "pending" };
    }

    this.connections.set(connectionId, { toolkit, status: "connected" });
    return { connectionId, status: "connected" };
  }

  /** Marks a pending Composio connected-account as active (simulates provider callback). */
  completeOAuth(composioConnectionId: string): void {
    const entry = this.connections.get(composioConnectionId);
    if (entry) entry.status = "connected";
  }

  async waitForOAuthCompletion(composioConnectionId: string): Promise<{ ok: boolean }> {
    const entry = this.connections.get(composioConnectionId);
    return { ok: entry?.status === "connected" };
  }

  async listToolMeta(connectionId: string): Promise<ComposioToolMeta[]> {
    return (
      this.state.toolMeta?.[connectionId] ?? [
        { name: "GITHUB_CREATE_ISSUE", sideEffect: true },
        { name: "GITHUB_LIST_ISSUES", sideEffect: false },
      ]
    );
  }

  async listTriggers(connectionId: string): Promise<ComposioTrigger[]> {
    return (
      this.state.triggers?.[connectionId] ?? [
        { slug: "github.new_issue", name: "New GitHub issue" },
      ]
    );
  }

  async mcpEndpoint(
    connectionId: string,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    return {
      url: `https://mock.composio.dev/mcp/${connectionId}`,
      headers: { "x-composio-api-key": this.apiKey },
    };
  }

  async subscribeTrigger(
    connectionId: string,
    slug: string,
    onEvent: (event: ComposioRealtimeEvent) => void,
  ): Promise<() => void> {
    const key = `${connectionId}:${slug}`;
    let listeners = this.subscriptions.get(key);
    if (!listeners) {
      listeners = new Set();
      this.subscriptions.set(key, listeners);
    }
    listeners.add(onEvent);
    return () => listeners!.delete(onEvent);
  }

  /** Test helper: push a trigger event to subscribers. */
  emitTrigger(
    connectionId: string,
    slug: string,
    payload: unknown,
    id = `tev_mock_${Date.now()}`,
  ): void {
    const key = `${connectionId}:${slug}`;
    const listeners = this.subscriptions.get(key);
    if (!listeners) return;
    const event = { id, payload };
    for (const listener of listeners) listener(event);
  }
}
