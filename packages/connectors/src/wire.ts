import type { ConnectorProvider } from "@openbot/contracts";
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
  /** Override Composio client (tests). */
  composioClient?: MockComposioClient | LiveComposioClient;
  composioApiKey?: string;
  registry?: McpRegistryClient;
}

function fakeFlag(name: string): boolean {
  return process.env[name] === "1";
}

async function resolveComposioApiKey(
  ctx: CoreContext,
  override?: string,
): Promise<string | undefined> {
  if (override) return override;
  if (process.env.COMPOSIO_API_KEY) return process.env.COMPOSIO_API_KEY;
  return ctx.vault.get(COMPOSIO_API_KEY);
}

/**
 * Boots WS10 into a running harness: registers the Composio setup validator and
 * attaches {@link ConnectorService} to `CoreContext`.
 */
export async function wireConnectors(
  ctx: CoreContext,
  options: WireConnectorsOptions = {},
): Promise<ConnectorService> {
  const now = () => ctx.clock.now();

  const mcp = new McpProvider({
    vault: ctx.vault,
    connections: ctx.repos.connections,
    registry: options.registry ?? new HttpMcpRegistryClient(),
    now,
    newConnectionId,
  });

  const providers: ConnectorProvider[] = [mcp];
  let composio: ComposioProvider | undefined;

  if (options.composioClient) {
    composio = new ComposioProvider({
      vault: ctx.vault,
      connections: ctx.repos.connections,
      client: options.composioClient,
      now,
      newConnectionId,
      oauthCallbackPort: ctx.config.port,
    });
    providers.push(composio);
  } else if (fakeFlag("OPENBOT_FAKE_COMPOSIO")) {
    const composioKey = options.composioApiKey ?? "composio_test_key_12345678";
    composio = new ComposioProvider({
      vault: ctx.vault,
      connections: ctx.repos.connections,
      client: new MockComposioClient(composioKey),
      now,
      newConnectionId,
      oauthCallbackPort: ctx.config.port,
    });
    providers.push(composio);
  } else {
    const composioKey = await resolveComposioApiKey(ctx, options.composioApiKey);
    if (composioKey) {
      composio = new ComposioProvider({
        vault: ctx.vault,
        connections: ctx.repos.connections,
        client: new LiveComposioClient(composioKey),
        now,
        newConnectionId,
        oauthCallbackPort: ctx.config.port,
      });
      providers.push(composio);
    }
  }

  ctx.validators.composio = async (value) => {
    if (!value || value.length < 8) return { ok: false, reason: "Composio API key too short" };
    if (!composio) return { ok: false, reason: "Composio is not configured on this harness" };
    const result = await composio.validateKey(value);
    if (result.ok) await ctx.vault.set(COMPOSIO_API_KEY, value);
    return result.ok ? { ok: true } : { ok: false, reason: "Invalid Composio API key" };
  };

  const service = new DefaultConnectorService({
    ctx,
    mcp,
    composio,
    providers,
    eventBus: ctx.eventBus,
  });

  ctx.connectorService = service;
  return service;
}
