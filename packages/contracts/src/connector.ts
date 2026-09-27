/**
 * Connectors (D-019): MCP servers the user connects once and assigns per Bot.
 * Shapes of `/api/connectors/*` (plan `2026-09-28-connectors.md`, "API contract").
 */

export type ConnectorKind = "remote" | "local";
export type ConnectorAuth = "none" | "token" | "oauth";
export type ConnectorSource = "curated" | "community";

/** One value the user enters when connecting (a token, a folder, an OAuth client id…). */
export interface ConnectorSetupField {
  key: string;
  label: string;
  help?: string;
  /** Secret values live only in the vault; never in the DB, events, or logs. */
  secret: boolean;
  placeholder?: string;
  /** Required unless `optional` is true. */
  optional?: boolean;
}

export interface ConnectorToolInfo {
  name: string;
  /** Write tools go through the permission broker (approval card); reads do not. */
  write: boolean;
}

export interface CatalogEntry {
  /** `curated:<slug>` or `registry:<registry server name>`. */
  id: string;
  name: string;
  publisher: string;
  category: string;
  description: string;
  kind: ConnectorKind;
  auth: ConnectorAuth;
  setup?: { fields: ConnectorSetupField[]; docsUrl?: string; steps?: string[] };
  tools?: ConnectorToolInfo[];
  /** First-party curated entry; registry (community) entries are always `false`. */
  verified: boolean;
  connected: boolean;
  /** First matching connection when `connected`. */
  connectionId?: string;
}

/** `GET /api/connectors/connections` item. */
export interface ConnectionView {
  id: string;
  catalogId: string;
  name: string;
  status: "connected" | "disconnected" | "error";
  createdAt: string;
}
