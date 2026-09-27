import type { McpServerSpec } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import type { McpConnectorComposer } from "./interfaces.js";

export class ConnectorMcpComposer implements McpConnectorComposer {
  constructor(private readonly ctx: CoreContext) {}

  async connectorServersForTurn(botId: string, _connectionIds: string[]): Promise<McpServerSpec[]> {
    if (!this.ctx.connectorService) return [];
    return this.ctx.connectorService.mcpServersForBot(botId);
  }
}
