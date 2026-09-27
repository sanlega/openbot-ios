import type { CatalogApp, Connection, McpServerSpec, TriggerDef } from "@openbot/contracts";
export interface ConnectorService {
  searchCatalog(q: string, page?: number, provider?: string): Promise<CatalogApp[]>;
  connect(input: ConnectorConnectInput): Promise<{ authUrl?: string; connectionId: string }>;
  listConnections(): Connection[];
  listTriggers(connectionId: string): Promise<TriggerDef[]>;
  mcpServersForBot(botId: string): Promise<McpServerSpec[]>;
  toolMeta(connectionId: string): Promise<Record<string, { sideEffect: boolean }>>;
  subscribeTrigger(
    connectionId: string,
    slug: string,
    config: unknown,
    onEvent: (e: { id: string; payload: unknown }) => void,
  ): Promise<() => void>;
  completeOAuth(
    connectionId: string,
    params?: { state?: string; code?: string },
  ): Promise<Connection>;
}

export interface ConnectorConnectInput {
  provider: "mcp" | "composio";
  appId: string;
  displayName?: string;
  mcpConfig?: {
    transport: "stdio" | "http";
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  };
}
