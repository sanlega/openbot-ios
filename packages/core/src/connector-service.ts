import type {
  CatalogEntry,
  ConnectionView,
  ConnectorSource,
  McpServerSpec,
} from "@openbot/contracts";

/** Plan `2026-09-28-connectors.md` (D-019). `@openbot/connectors` implements it. */
export interface ConnectorService {
  /** Curated entries always; community entries come from the MCP Registry (may fail: `error`). */
  catalog(source: ConnectorSource, q: string): Promise<{ entries: CatalogEntry[]; error?: string }>;
  /** Throws {@link ConnectorError} for unknown entries, missing fields, or unsupported auth. */
  connect(input: ConnectorConnectInput): Promise<ConnectionView>;
  listConnections(): ConnectionView[];
  /** Removes the connection, its vault keys, and its assignment from every Bot. False if unknown. */
  disconnect(connectionId: string): Promise<boolean>;
  /** MCP servers for a Bot's turn: only its assigned, connected connections. */
  mcpServersForBot(botId: string): Promise<McpServerSpec[]>;
  /**
   * Classifies an engine tool call that targets one of the Bot's connector
   * servers (e.g. `mcp__github__create_issue`); `undefined` for other tools.
   */
  classifyTool(botId: string, toolName: string, input?: unknown): ConnectorToolClass | undefined;
}

export interface ConnectorConnectInput {
  catalogId: string;
  values: Record<string, string>;
  displayName?: string;
}

/** Broker fields for a connector tool call (a `Partial<BrokerRequest>` in `@openbot/runtime`). */
export interface ConnectorToolClass {
  kind: "connector_action";
  action: string;
  /** The connection's display name. */
  target: string;
  sideEffect: boolean;
  readOnly: boolean;
  summary: string;
}

export type ConnectorErrorCode =
  "unknown_catalog_entry" | "missing_fields" | "oauth_not_supported_yet" | "unsupported_server";

/** A connect request the user can fix; the Client API maps it to 4xx `{ error, reason }`. */
export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
    readonly status: 400 | 404 | 409 = 400,
    readonly fields?: string[],
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
