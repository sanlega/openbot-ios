import type {
  CatalogApp,
  Connection,
  ConnectorProvider,
  McpServerSpec,
  TriggerDef,
} from "@openbot/contracts";
import { newId } from "@openbot/contracts";
import type { CoreContext, ConnectorService as CoreConnectorService } from "@openbot/core";
import type { EventBus } from "@openbot/core";
import type { ConnectRequest } from "./types.js";
import { catalogId, parseCatalogId } from "./types.js";
import type { McpProvider } from "./mcp-provider.js";
import type { ComposioProvider } from "./composio/provider.js";

export interface ConnectorService extends CoreConnectorService {
  getProvider(id: string): ConnectorProvider | undefined;
  finishOAuth?(connectionId: string): Promise<void>;
}

export interface ConnectorServiceDeps {
  ctx: CoreContext;
  mcp: McpProvider;
  composio: ComposioProvider;
  providers: ConnectorProvider[];
  eventBus: EventBus;
}

/** Aggregates raw MCP + Composio providers; future Pipedream plugs in via `providers[]`. */
export class DefaultConnectorService implements ConnectorService {
  private readonly byId = new Map<string, ConnectorProvider>();

  constructor(private readonly deps: ConnectorServiceDeps) {
    for (const provider of deps.providers) {
      this.byId.set(provider.id, provider);
    }
  }

  getProvider(id: string): ConnectorProvider | undefined {
    return this.byId.get(id);
  }

  async searchCatalog(q: string, page?: number, provider?: string): Promise<CatalogApp[]> {
    const targets = provider ? [this.requireProvider(provider)] : this.deps.providers;
    const results = await Promise.all(targets.map((p) => p.searchCatalog(q, page)));
    return results.flat();
  }

  async connect(input: ConnectRequest): Promise<{ authUrl?: string; connectionId: string }> {
    const provider = this.requireProvider(input.provider);
    let result: { authUrl?: string; connectionId: string };

    if (input.provider === "mcp") {
      result = await this.deps.mcp.connect(input.appId, {
        appId: this.deps.mcp.resolveAppId(input.appId),
        displayName: input.displayName,
        mcpConfig: input.mcpConfig,
      });
    } else {
      result = await provider.connect(input.appId);
    }

    await this.deps.eventBus.publish({
      type: "connector.connected",
      payload: { connectionId: result.connectionId, provider: input.provider },
    });

    return result;
  }

  listConnections(): Connection[] {
    return this.deps.ctx.repos.connections.list();
  }

  async listTriggers(connectionId: string): Promise<TriggerDef[]> {
    const provider = this.providerForConnection(connectionId);
    if (!provider.listTriggers) return [];
    return provider.listTriggers(connectionId);
  }

  async mcpServersForBot(botId: string): Promise<McpServerSpec[]> {
    const bot = this.deps.ctx.repos.bots.getById(botId);
    if (!bot) throw new Error(`Unknown bot ${botId}`);

    const specs: McpServerSpec[] = [];
    for (const connectionId of bot.connectors) {
      const connection = this.deps.ctx.repos.connections.getById(connectionId);
      if (!connection || connection.status !== "connected") continue;
      const provider = this.providerForConnection(connectionId);
      specs.push(await provider.mcpServerFor(botId, [connectionId]));
    }
    return specs;
  }

  async toolMeta(connectionId: string): Promise<Record<string, { sideEffect: boolean }>> {
    const provider = this.providerForConnection(connectionId);
    return provider.toolMeta(connectionId);
  }

  async subscribeTrigger(
    connectionId: string,
    slug: string,
    config: unknown,
    onEvent: (e: { id: string; payload: unknown }) => void,
  ): Promise<() => void> {
    const provider = this.providerForConnection(connectionId);
    if (!provider.subscribeTrigger) {
      throw new Error(`Provider for ${connectionId} does not support triggers`);
    }
    return provider.subscribeTrigger(connectionId, slug, config, onEvent);
  }

  async finishOAuth(connectionId: string): Promise<void> {
    await this.deps.composio.finishOAuth(connectionId);
  }

  private providerForConnection(connectionId: string): ConnectorProvider {
    const connection = this.deps.ctx.repos.connections.getById(connectionId);
    if (!connection) throw new Error(`Unknown connection ${connectionId}`);
    return this.requireProvider(connection.provider);
  }

  private requireProvider(id: string): ConnectorProvider {
    const provider = this.byId.get(id);
    if (!provider) throw new Error(`Unknown connector provider "${id}"`);
    return provider;
  }
}

export function newConnectionId(): string {
  return newId("connection");
}

export { catalogId, parseCatalogId };
