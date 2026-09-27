import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Bot, McpServerSpec } from "@openbot/contracts";
import { BASE_TOOLS, COS_ONLY_TOOLS, OPENBOT_TOOL_DEFINITIONS } from "./tool-definitions.js";
import type { SessionClaims } from "./types.js";
import type { McpConnectorComposer } from "./services/interfaces.js";
import type { SessionTokenService } from "./session-token.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHIM_PATH = join(PACKAGE_ROOT, "dist", "shim", "stdio.js");

export interface McpComposerInput {
  bot: Bot;
  turnId: string;
  chainId: string;
  mode: SessionClaims["mode"];
  harnessUrl: string;
  sessionToken: string;
  connectors?: McpConnectorComposer;
}

/**
 * Builds the MCP server list for one engine turn (plan §4.9 / WS4).
 * Injects CoS-only tools only for the Chief of Staff and appends connector servers.
 */
export class McpComposer {
  static openbotServerSpec(harnessUrl: string, sessionToken: string, bot: Bot): McpServerSpec {
    return {
      name: "openbot",
      command: process.execPath,
      args: [SHIM_PATH],
      env: {
        OPENBOT_API_URL: harnessUrl,
        OPENBOT_SESSION_TOKEN: sessionToken,
        ...(bot.isChiefOfStaff ? { OPENBOT_COS_TOOLS: "1" } : {}),
      },
    };
  }

  static async forTurnAsync(
    tokens: SessionTokenService,
    input: Omit<McpComposerInput, "sessionToken" | "connectors"> & {
      connectors?: McpConnectorComposer;
    },
  ): Promise<{ servers: McpServerSpec[]; token: string; tools: string[] }> {
    const token = tokens.issue({
      botId: input.bot.id,
      turnId: input.turnId,
      chainId: input.chainId,
      mode: input.mode,
    });

    const servers: McpServerSpec[] = [this.openbotServerSpec(input.harnessUrl, token, input.bot)];

    if (input.connectors && input.bot.connectors.length > 0) {
      const connectorServers = await input.connectors.connectorServersForTurn(
        input.bot.id,
        input.bot.connectors,
      );
      servers.push(...connectorServers);
    }

    return { servers, token, tools: this.toolsForBot(input.bot) };
  }

  static toolsForBot(bot: Bot): string[] {
    return bot.isChiefOfStaff
      ? OPENBOT_TOOL_DEFINITIONS.map((t) => t.name)
      : BASE_TOOLS.map((t) => t.name);
  }

  static isToolAllowed(bot: Bot, toolName: string): boolean {
    if (COS_ONLY_TOOLS.has(toolName)) return bot.isChiefOfStaff;
    return OPENBOT_TOOL_DEFINITIONS.some((t) => t.name === toolName);
  }
}
