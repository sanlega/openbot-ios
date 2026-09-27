import type { McpServerSpec } from "./engine-driver.js";

/** Plan §4.6 (WS10 implements; WS4/WS12 consume). */

export interface CatalogApp {
  id: string;
  name: string;
  description?: string;
}

/** Provider-side view of a connection, distinct from the persisted `Connection` entity in `entities.ts`. */
export interface ProviderConnection {
  id: string;
  appId: string;
  displayName: string;
  status: "connected" | "disconnected" | "error";
}

export interface TriggerDef {
  slug: string;
  name: string;
  description?: string;
}

export interface ConnectorProvider {
  /** `'mcp' | 'composio' | string`. */
  id: string;
  validateKey?(key: string): Promise<{ ok: boolean }>;
  searchCatalog(q: string, page?: number): Promise<CatalogApp[]>;
  connect(appId: string): Promise<{ authUrl?: string; connectionId: string }>;
  listConnections(): Promise<ProviderConnection[]>;
  mcpServerFor(botId: string, connectionIds: string[]): Promise<McpServerSpec>;
  toolMeta(connectionId: string): Promise<Record<string, { sideEffect: boolean }>>;
  listTriggers?(connectionId: string): Promise<TriggerDef[]>;
  /** Outbound only — no inbound port needed. Returns an unsubscribe function. */
  subscribeTrigger?(
    connectionId: string,
    slug: string,
    config: unknown,
    onEvent: (e: { id: string; payload: unknown }) => void,
  ): Promise<() => void>;
}
