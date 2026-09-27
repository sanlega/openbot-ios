import type { CoreContext } from "@openbot/core";
import { HttpMcpRegistryClient, type McpRegistryClient } from "./mcp-registry.js";
import { McpProvider } from "./mcp-provider.js";
import { LiveComposioClient } from "./composio/live-client.js";
import { MockComposioClient } from "./composio/mock-client.js";
import { ComposioProvider } from "./composio/provider.js";
import {
  DefaultConnectorService,
  newConnectionId,
  type ConnectorService,
} from "./connector-service.js";
import { COMPOSIO_API_KEY } from "./vault-keys.js";

export interface WireConnectorsOptions {
  /** Override Composio client (tests). When omitted, mock is used unless `OPENBOT_COMPOSIO_LIVE=1`. */
  composioClient?: MockComposioClient;
  composioApiKey?: string;
  registry?: McpRegistryClient;
}

/**
 * Boots WS10 into a running harness: registers the Composio setup validator and
 * attaches {@link ConnectorService} to `CoreContext`.
 */
export function wireConnectors(
  ctx: CoreContext,
  options: WireConnectorsOptions = {},
): ConnectorService {
  const now = () => ctx.clock.now();

  const mcp = new McpProvider({
    vault: ctx.vault,
    connections: ctx.repos.connections,
    registry: options.registry ?? new HttpMcpRegistryClient(),
    now,
    newConnectionId,
  });

  const composioKey = options.composioApiKey ?? "composio_test_key_12345678";
  const composioClient =
    options.composioClient ??
    (process.env.OPENBOT_COMPOSIO_LIVE === "1" && process.env.COMPOSIO_API_KEY
      ? new LiveComposioClient(process.env.COMPOSIO_API_KEY)
      : new MockComposioClient(composioKey));

  const composio = new ComposioProvider({
    vault: ctx.vault,
    connections: ctx.repos.connections,
    client: composioClient,
    now,
    newConnectionId,
  });

  ctx.validators.composio = async (value) => {
    if (!value || value.length < 8) return { ok: false, reason: "Composio API key too short" };
    const result = await composio.validateKey(value);
    if (result.ok) await ctx.vault.set(COMPOSIO_API_KEY, value);
    return result.ok ? { ok: true } : { ok: false, reason: "Invalid Composio API key" };
  };

  const service = new DefaultConnectorService({
    ctx,
    mcp,
    composio,
    providers: [mcp, composio],
    eventBus: ctx.eventBus,
  });

  ctx.connectorService = service;
  return service;
}
