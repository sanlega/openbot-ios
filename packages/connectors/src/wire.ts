import type { CoreContext } from "@openbot/core";
import { DefaultConnectorService } from "./connector-service.js";
import {
  DEFAULT_REGISTRY_URL,
  HttpMcpRegistryClient,
  type McpRegistryClient,
} from "./mcp-registry.js";

export interface WireConnectorsOptions {
  /** Override the MCP Registry client (tests). */
  registry?: McpRegistryClient;
}

/**
 * Attaches the connector service to `CoreContext` (D-019). The Community
 * catalogue reads the public MCP Registry, or `OPENBOT_MCP_REGISTRY_URL`.
 */
export function wireConnectors(
  ctx: CoreContext,
  options: WireConnectorsOptions = {},
): DefaultConnectorService {
  const registry =
    options.registry ??
    new HttpMcpRegistryClient(process.env.OPENBOT_MCP_REGISTRY_URL || DEFAULT_REGISTRY_URL);
  const service = new DefaultConnectorService({ ctx, registry });
  ctx.connectorService = service;
  return service;
}
