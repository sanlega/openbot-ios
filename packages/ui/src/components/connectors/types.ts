/** Shapes of `/api/connectors/*` (see .ai/memory/plans/2026-09-28-connectors.md). */
export interface ConnectorSetupField {
  key: string;
  label: string;
  help?: string;
  secret: boolean;
  placeholder?: string;
  optional?: boolean;
}

export interface ConnectorCatalogEntry {
  id: string;
  name: string;
  publisher?: string;
  category?: string;
  description?: string;
  kind: "remote" | "local";
  auth: "none" | "token" | "oauth";
  setup?: { fields?: ConnectorSetupField[]; docsUrl?: string; steps?: string[] };
  tools?: Array<{ name: string; write: boolean }>;
  verified: boolean;
  connected: boolean;
  connectionId?: string;
}

export interface ConnectorConnection {
  id: string;
  catalogId?: string;
  name: string;
  status: "connected" | "disconnected" | "error" | string;
  createdAt?: string;
}
