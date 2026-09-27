import type {
  CatalogApp,
  ConnectorProvider,
  McpServerSpec,
  ProviderConnection,
  TriggerDef,
} from "@openbot/contracts";
import type { Vault } from "@openbot/core";
import type { ConnectionsRepo } from "@openbot/store";
import { type ComposioClient, toTriggerDef, toolkitToCatalogApp } from "./client.js";
import { COMPOSIO_API_KEY, composioOAuthAppKeys, connectionSecretKey } from "../vault-keys.js";
import { catalogId, parseCatalogId } from "../types.js";

export interface ComposioProviderDeps {
  vault: Vault;
  connections: ConnectionsRepo;
  client: ComposioClient;
  now: () => Date;
  newConnectionId: () => string;
}

/**
 * Composio managed catalog provider (plan §5 WS10): per-user BYO API key and optional
 * BYO OAuth app credentials, tool `sideEffect` metadata for the broker, and outbound
 * trigger subscriptions for WS12.
 */
export class ComposioProvider implements ConnectorProvider {
  readonly id = "composio";

  /** Maps OpenBot `con_*` ids to Composio connected-account ids. */
  private readonly composioIds = new Map<string, string>();

  constructor(private readonly deps: ComposioProviderDeps) {}

  async validateKey(key: string): Promise<{ ok: boolean }> {
    return this.deps.client.validateKey(key);
  }

  async searchCatalog(q: string, page?: number): Promise<CatalogApp[]> {
    const toolkits = await this.deps.client.searchToolkits(q, page);
    return toolkits.map(toolkitToCatalogApp);
  }

  async connect(appId: string): Promise<{ authUrl?: string; connectionId: string }> {
    const toolkit = this.resolveToolkit(appId);
    const oauth = await this.loadOAuthCredentials(toolkit);
    const result = await this.deps.client.connectToolkit(toolkit, oauth);

    const connectionId = this.deps.newConnectionId();
    this.composioIds.set(connectionId, result.connectionId);

    const toolMetaEntries =
      result.status === "connected" ? await this.fetchToolMeta(result.connectionId) : {};

    this.deps.connections.create({
      id: connectionId,
      provider: "composio",
      appId: toolkit,
      displayName: toolkit,
      status: result.status === "connected" ? "connected" : "disconnected",
      toolMeta: toolMetaEntries,
      triggers:
        result.status === "connected"
          ? (await this.deps.client.listTriggers(result.connectionId)).map((t) => t.slug)
          : [],
      createdAt: this.deps.now().toISOString(),
    });

    await this.deps.vault.set(connectionSecretKey(connectionId), result.connectionId);

    return { authUrl: result.authUrl, connectionId };
  }

  /** Completes OAuth for a pending Composio connection. */
  async finishOAuth(connectionId: string): Promise<void> {
    const composioId = await this.composioIdFor(connectionId);
    if (this.deps.client instanceof Object && "completeOAuth" in this.deps.client) {
      (this.deps.client as { completeOAuth(id: string): void }).completeOAuth(composioId);
    }
    const toolMeta = await this.fetchToolMeta(composioId);
    const triggers = (await this.deps.client.listTriggers(composioId)).map((t) => t.slug);
    this.deps.connections.update(connectionId, {
      status: "connected",
      toolMeta,
      triggers,
    });
  }

  async listConnections(): Promise<ProviderConnection[]> {
    return this.deps.connections
      .list()
      .filter((c) => c.provider === "composio")
      .map((c) => ({
        id: c.id,
        appId: catalogId("composio", c.appId),
        displayName: c.displayName,
        status: c.status,
      }));
  }

  async mcpServerFor(_botId: string, connectionIds: string[]): Promise<McpServerSpec> {
    const connectionId = connectionIds[0];
    if (!connectionId) throw new Error("mcpServerFor requires at least one connectionId");

    const connection = this.deps.connections.getById(connectionId);
    if (!connection || connection.provider !== "composio") {
      throw new Error(`Unknown Composio connection ${connectionId}`);
    }
    if (connection.status !== "connected") {
      throw new Error(`Composio connection ${connectionId} is not connected`);
    }

    const composioId = await this.composioIdFor(connectionId);
    const endpoint = await this.deps.client.mcpEndpoint(composioId);
    const serverName = `composio_${connection.appId.replace(/[^a-z0-9]+/gi, "_")}`;

    // Headers carry auth — injected as env for the MCP remote shim, never logged.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(endpoint.headers)) {
      env[`COMPOSIO_HDR_${key.toUpperCase().replace(/-/g, "_")}`] = value;
    }

    return {
      name: serverName,
      command: "npx",
      args: ["-y", "mcp-remote", endpoint.url],
      env,
    };
  }

  async toolMeta(connectionId: string): Promise<Record<string, { sideEffect: boolean }>> {
    const connection = this.deps.connections.getById(connectionId);
    return connection?.toolMeta ?? {};
  }

  async listTriggers(connectionId: string): Promise<TriggerDef[]> {
    const composioId = await this.composioIdFor(connectionId);
    const triggers = await this.deps.client.listTriggers(composioId);
    return triggers.map(toTriggerDef);
  }

  async subscribeTrigger(
    connectionId: string,
    slug: string,
    _config: unknown,
    onEvent: (e: { id: string; payload: unknown }) => void,
  ): Promise<() => void> {
    const composioId = await this.composioIdFor(connectionId);
    return this.deps.client.subscribeTrigger(composioId, slug, onEvent);
  }

  resolveToolkit(catalogOrAppId: string): string {
    const { provider, appId } = parseCatalogId(catalogOrAppId);
    return provider === "composio" ? appId : catalogOrAppId;
  }

  private async composioIdFor(connectionId: string): Promise<string> {
    const mapped = this.composioIds.get(connectionId);
    if (mapped) return mapped;
    const fromVault = await this.deps.vault.get(connectionSecretKey(connectionId));
    if (fromVault) {
      this.composioIds.set(connectionId, fromVault);
      return fromVault;
    }
    throw new Error(`Missing Composio mapping for ${connectionId}`);
  }

  private async loadOAuthCredentials(
    appId: string,
  ): Promise<{ oauthClientId?: string; oauthClientSecret?: string } | undefined> {
    const keys = composioOAuthAppKeys(appId);
    const oauthClientId = await this.deps.vault.get(keys.clientId);
    const oauthClientSecret = await this.deps.vault.get(keys.clientSecret);
    if (oauthClientId && oauthClientSecret) return { oauthClientId, oauthClientSecret };
    return undefined;
  }

  private async fetchToolMeta(
    composioConnectionId: string,
  ): Promise<Record<string, { sideEffect: boolean }>> {
    const tools = await this.deps.client.listToolMeta(composioConnectionId);
    return Object.fromEntries(tools.map((t) => [t.name, { sideEffect: t.sideEffect }]));
  }

  /** Registers the user's Composio API key in the vault (setup wizard). */
  async storeApiKey(key: string): Promise<void> {
    await this.deps.vault.set(COMPOSIO_API_KEY, key);
  }

  async loadApiKey(): Promise<string | undefined> {
    return this.deps.vault.get(COMPOSIO_API_KEY);
  }
}
