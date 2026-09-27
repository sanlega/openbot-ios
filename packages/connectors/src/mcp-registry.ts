import type { CatalogApp } from "@openbot/contracts";
import { catalogId } from "./types.js";

const DEFAULT_REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";

export interface RegistryServer {
  name: string;
  description?: string;
  version?: string;
}

export interface McpRegistryClient {
  search(q: string, page?: number): Promise<CatalogApp[]>;
}

/** Browses the public MCP Registry (plan §5 WS10). Network failures return []. */
export class HttpMcpRegistryClient implements McpRegistryClient {
  constructor(
    private readonly registryUrl = DEFAULT_REGISTRY_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(q: string, page = 0): Promise<CatalogApp[]> {
    try {
      const url = new URL(this.registryUrl);
      if (q.trim()) url.searchParams.set("search", q.trim());
      url.searchParams.set("offset", String(page * 20));
      url.searchParams.set("limit", "20");

      const response = await this.fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return [];

      const body = (await response.json()) as { servers?: RegistryServer[] } | RegistryServer[];
      const servers = Array.isArray(body) ? body : (body.servers ?? []);
      return servers.map((server) => ({
        id: catalogId("mcp", server.name),
        name: server.name,
        description: server.description,
      }));
    } catch {
      return [];
    }
  }
}

/** Deterministic registry for unit tests. */
export class MockMcpRegistryClient implements McpRegistryClient {
  constructor(private readonly apps: CatalogApp[]) {}

  async search(q: string): Promise<CatalogApp[]> {
    const needle = q.trim().toLowerCase();
    if (!needle) return this.apps;
    return this.apps.filter(
      (app) =>
        app.name.toLowerCase().includes(needle) ||
        app.id.toLowerCase().includes(needle) ||
        app.description?.toLowerCase().includes(needle),
    );
  }
}
