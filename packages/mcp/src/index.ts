/**
 * `@openbot/mcp` (plan §5 WS4): OpenBot MCP stdio shim, §4.9 tool handlers,
 * session tokens, and per-turn MCP config composer.
 */
export { SessionTokenService, generateSessionSecret } from "./session-token.js";
export { McpComposer } from "./composer.js";
export { integrateMcp, type IntegrateMcpOptions } from "./integrate.js";
export { registerInternalToolRoutes, type InternalToolsOptions } from "./http/register.js";
export { createToolRouter, ToolRouter } from "./handlers.js";
export { OPENBOT_TOOL_DEFINITIONS, BASE_TOOLS, COS_ONLY_TOOLS } from "./tool-definitions.js";
export { TOOL_INPUT_SCHEMAS } from "./tool-schemas.js";
export type {
  SessionClaims,
  SessionContext,
  ToolRefusal,
  ToolResult,
  ToolSuccess,
} from "./types.js";
export { allowed, refused } from "./types.js";
export type {
  McpToolServices,
  McpRuntimeService,
  McpCosService,
  McpComputerService,
  McpRoutineService,
  McpConnectorComposer,
} from "./services/interfaces.js";
export { createFakeMcpServices } from "./services/fakes.js";
