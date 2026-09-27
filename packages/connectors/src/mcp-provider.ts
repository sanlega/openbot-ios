import type {
  CatalogApp,
  ConnectorProvider,
  McpServerSpec,
  ProviderConnection,
  TriggerDef,
} from "@openbot/contracts";
import type { Vault } from "@openbot/core";
import type { ConnectionsRepo } from "@openbot/store";
import {
  catalogId,
  parseCatalogId,
  StoredMcpConfig,
  type StoredMcpConfig as McpConfig,
} from "./types.js";
import { connectionEnvKey, connectionMcpConfigKey } from "./vault-keys.js";
import type { McpRegistryClient } from "./mcp-registry.js";

export interface McpConnectInput {
  appId: string;
  displayName?: string;
  mcpConfig?: McpConfig & { env?: Record<string, string> };
}

export interface McpProviderDeps {
  vault: Vault;
  connections: ConnectionsRepo;
  registry: McpRegistryClient;
  now: () => Date;
  newConnectionId: () => string;
}

/**
 * Raw MCP connector provider (plan §5 WS10): MCP Registry browsing, manual stdio/HTTP
 * servers, vault-injected secrets. Secrets never touch the DB — only vault keys and
 * env injection at MCP spawn time.
 */
export class McpProvider implements ConnectorProvider {
  readonly id = "mcp";

  constructor(private readonly deps: McpProviderDeps) {}

  async searchCatalog(q: string, page?: number): Promise<CatalogApp[]> {
    return this.deps.registry.search(q, page);
  }

  async connect(
    appId: string,
    input?: Partial<McpConnectInput>,
  ): Promise<{
    authUrl?: string;
    connectionId: string;
  }> {
    const resolvedAppId = this.resolveAppId(appId);
    const connectionId = this.deps.newConnectionId();
    const name = input?.displayName ?? resolvedAppId;
    const mcpConfig = input?.mcpConfig;

    if (mcpConfig) {
      const parsed = StoredMcpConfig.parse(mcpConfig);
      const secretEnvKeys = Object.keys(mcpConfig.env ?? {});
      await this.deps.vault.set(
        connectionMcpConfigKey(connectionId),
        JSON.stringify({ ...parsed, secretEnvKeys }),
      );
      for (const [envName, value] of Object.entries(mcpConfig.env ?? {})) {
        await this.deps.vault.set(connectionEnvKey(connectionId, envName), value);
      }
    } else {
      await this.deps.vault.set(
        connectionMcpConfigKey(connectionId),
        JSON.stringify({
          transport: "stdio",
          command: "npx",
          args: ["-y", `@modelcontextprotocol/server-${resolvedAppId}`],
          secretEnvKeys: [],
        } satisfies McpConfig),
      );
    }

    this.deps.connections.create({
      id: connectionId,
      provider: "mcp",
      appId: resolvedAppId,
      displayName: name,
      status: "connected",
      toolMeta: {},
      triggers: [],
      createdAt: this.deps.now().toISOString(),
    });

    return { connectionId };
  }

  async listConnections(): Promise<ProviderConnection[]> {
    return this.deps.connections
      .list()
      .filter((c) => c.provider === "mcp")
      .map(toProviderConnection);
  }

  async mcpServerFor(_botId: string, connectionIds: string[]): Promise<McpServerSpec> {
    const connectionId = connectionIds[0];
    if (!connectionId) throw new Error("mcpServerFor requires at least one connectionId");

    const connection = this.deps.connections.getById(connectionId);
    if (!connection || connection.provider !== "mcp") {
      throw new Error(`Unknown MCP connection ${connectionId}`);
    }

    const raw = await this.deps.vault.get(connectionMcpConfigKey(connectionId));
    if (!raw) throw new Error(`Missing MCP config for ${connectionId}`);
    const config = StoredMcpConfig.parse(JSON.parse(raw));

    const env: Record<string, string> = {};
    for (const key of config.secretEnvKeys) {
      const value = await this.deps.vault.get(connectionEnvKey(connectionId, key));
      if (value) env[key] = value;
    }

    const serverName = `mcp_${connection.appId.replace(/[^a-z0-9]+/gi, "_")}`;

    if (config.transport === "http") {
      return {
        name: serverName,
        command: "npx",
        args: ["-y", "mcp-remote", config.url ?? ""],
        env,
      };
    }

    return {
      name: serverName,
      command: config.command ?? "node",
      args: config.args,
      env,
    };
  }

  async toolMeta(connectionId: string): Promise<Record<string, { sideEffect: boolean }>> {
    const connection = this.deps.connections.getById(connectionId);
    return connection?.toolMeta ?? {};
  }

  async listTriggers(_connectionId: string): Promise<TriggerDef[]> {
    return [];
  }

  resolveAppId(catalogOrAppId: string): string {
    const { provider, appId } = parseCatalogId(catalogOrAppId);
    return provider === "mcp" ? appId : catalogOrAppId;
  }
}

function toProviderConnection(connection: {
  id: string;
  appId: string;
  displayName: string;
  status: ProviderConnection["status"];
}): ProviderConnection {
  return {
    id: connection.id,
    appId: catalogId("mcp", connection.appId),
    displayName: connection.displayName,
    status: connection.status,
  };
}
