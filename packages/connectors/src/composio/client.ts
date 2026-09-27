import type { CatalogApp, TriggerDef } from "@openbot/contracts";

export interface ComposioToolkit {
  slug: string;
  name: string;
  description?: string;
}

export interface ComposioToolMeta {
  name: string;
  sideEffect: boolean;
}

export interface ComposioTrigger {
  slug: string;
  name: string;
  description?: string;
}

export interface ComposioConnectResult {
  connectionId: string;
  authUrl?: string;
  status: "connected" | "pending";
}

export interface ComposioRealtimeEvent {
  id: string;
  payload: unknown;
}

/** Minimal Composio API surface — live client is opt-in; tests use {@link MockComposioClient}. */
export interface ComposioClient {
  validateKey(key: string): Promise<{ ok: boolean }>;
  searchToolkits(q: string, page?: number): Promise<ComposioToolkit[]>;
  connectToolkit(
    toolkit: string,
    options?: {
      oauthClientId?: string;
      oauthClientSecret?: string;
      redirectUri?: string;
      state?: string;
    },
  ): Promise<ComposioConnectResult>;
  waitForOAuthCompletion(composioConnectionId: string): Promise<{ ok: boolean }>;
  listToolMeta(connectionId: string): Promise<ComposioToolMeta[]>;
  listTriggers(connectionId: string): Promise<ComposioTrigger[]>;
  mcpEndpoint(connectionId: string): Promise<{ url: string; headers: Record<string, string> }>;
  subscribeTrigger(
    connectionId: string,
    slug: string,
    onEvent: (event: ComposioRealtimeEvent) => void,
  ): Promise<() => void>;
}

export function toolkitToCatalogApp(toolkit: ComposioToolkit): CatalogApp {
  return {
    id: `composio:${toolkit.slug}`,
    name: toolkit.name,
    description: toolkit.description,
  };
}

export function toTriggerDef(trigger: ComposioTrigger): TriggerDef {
  return { slug: trigger.slug, name: trigger.name, description: trigger.description };
}
