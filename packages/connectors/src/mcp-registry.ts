import type { CatalogEntry, ConnectorSetupField } from "@openbot/contracts";
import type { ConnectorTemplate } from "./catalog/curated.js";

export const DEFAULT_REGISTRY_URL = "https://registry.modelcontextprotocol.io";
export const REGISTRY_PREFIX = "registry:";

/** `server.json` (MCP Registry API v0.1), the fields OpenBot uses. */
export interface RegistryServer {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: { url?: string; source?: string };
  remotes?: Array<{
    type: string;
    url: string;
    headers?: RegistryInput[];
  }>;
  packages?: Array<{
    registryType: string;
    identifier: string;
    version?: string;
    transport?: { type: string };
    environmentVariables?: RegistryInput[];
  }>;
}

export interface RegistryInput {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  value?: string;
  default?: string;
}

interface RegistryListResponse {
  servers?: Array<{ server?: RegistryServer } | RegistryServer>;
  metadata?: { nextCursor?: string; count?: number };
}

export interface McpRegistryClient {
  /** Latest version of each matching server. Throws on network/HTTP errors. */
  search(q: string): Promise<RegistryServer[]>;
  /** One server by name (latest version); `undefined` if the registry does not have it. */
  get(name: string): Promise<RegistryServer | undefined>;
}

/** The public MCP Registry, `/v0.1/servers` (unvetted: shown as "Community"). */
export class HttpMcpRegistryClient implements McpRegistryClient {
  private readonly cache = new Map<string, RegistryServer>();

  constructor(
    private readonly baseUrl = DEFAULT_REGISTRY_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(q: string): Promise<RegistryServer[]> {
    const url = new URL("/v0.1/servers", this.baseUrl);
    if (q.trim()) url.searchParams.set("search", q.trim());
    url.searchParams.set("version", "latest");
    url.searchParams.set("limit", "30");
    const body = (await this.getJson(url)) as RegistryListResponse;
    const seen = new Set<string>();
    const servers: RegistryServer[] = [];
    for (const item of body.servers ?? []) {
      const server = "server" in item && item.server ? item.server : (item as RegistryServer);
      if (!server?.name || seen.has(server.name)) continue;
      seen.add(server.name);
      this.cache.set(server.name, server);
      servers.push(server);
    }
    return servers;
  }

  async get(name: string): Promise<RegistryServer | undefined> {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const url = new URL(`/v0.1/servers/${encodeURIComponent(name)}/versions/latest`, this.baseUrl);
    try {
      const body = (await this.getJson(url)) as { server?: RegistryServer } | RegistryServer;
      const server = "server" in body && body.server ? body.server : (body as RegistryServer);
      return server?.name ? server : undefined;
    } catch {
      return undefined;
    }
  }

  private async getJson(url: URL): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`MCP Registry answered ${response.status}`);
    return response.json();
  }
}

/** Deterministic registry for tests. */
export class MockMcpRegistryClient implements McpRegistryClient {
  constructor(
    private readonly servers: RegistryServer[],
    private readonly failWith?: string,
  ) {}

  async search(q: string): Promise<RegistryServer[]> {
    if (this.failWith) throw new Error(this.failWith);
    const needle = q.trim().toLowerCase();
    return this.servers.filter(
      (s) =>
        !needle ||
        s.name.toLowerCase().includes(needle) ||
        s.description?.toLowerCase().includes(needle),
    );
  }

  async get(name: string): Promise<RegistryServer | undefined> {
    return this.servers.find((s) => s.name === name);
  }
}

/** Env-var-safe key for a header or variable name. */
function fieldKey(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
}

function toField(input: RegistryInput, placeholder?: string): ConnectorSetupField {
  return {
    key: fieldKey(input.name),
    label: input.name,
    help: input.description,
    secret: input.isSecret ?? true,
    placeholder: placeholder ?? input.default,
    optional: input.isRequired !== true,
  };
}

/**
 * What OpenBot can run for a registry server: its remote endpoint when it has
 * one, else an npm (`npx`) or PyPI (`uvx`) stdio package. `undefined` for
 * anything else (Docker images, custom transports).
 */
export function registryPlan(
  server: RegistryServer,
): { template: ConnectorTemplate; fields: ConnectorSetupField[] } | undefined {
  const remote = server.remotes?.find((r) => r.type === "streamable-http" || r.type === "sse");
  if (remote && /^https:\/\//.test(remote.url)) {
    const headers: Record<string, string> = {};
    const fields: ConnectorSetupField[] = [];
    for (const header of remote.headers ?? []) {
      const field = toField(header, header.value);
      fields.push(field);
      headers[header.name] = `\${${field.key}}`;
    }
    return { template: { transport: "remote", url: remote.url, headers }, fields };
  }

  for (const pkg of server.packages ?? []) {
    if (pkg.transport && pkg.transport.type !== "stdio") continue;
    let command: string;
    let spec: string;
    if (pkg.registryType === "npm") {
      command = "npx";
      spec = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
    } else if (pkg.registryType === "pypi") {
      command = "uvx";
      spec = pkg.version ? `${pkg.identifier}==${pkg.version}` : pkg.identifier;
    } else {
      continue;
    }
    const env: Record<string, string> = {};
    const fields: ConnectorSetupField[] = [];
    for (const variable of pkg.environmentVariables ?? []) {
      const field = toField(variable);
      fields.push(field);
      env[variable.name] = `\${${field.key}}`;
    }
    const args = command === "npx" ? ["-y", spec] : [spec];
    return { template: { transport: "local", command, args, env }, fields };
  }
  return undefined;
}

/** Community catalogue entry for a registry server (always unverified). */
export function registryEntry(server: RegistryServer, connectionId?: string): CatalogEntry {
  const plan = registryPlan(server);
  const fields = plan?.fields ?? [];
  const [namespace, short] = server.name.includes("/")
    ? [
        server.name.slice(0, server.name.indexOf("/")),
        server.name.slice(server.name.indexOf("/") + 1),
      ]
    : ["", server.name];
  return {
    id: `${REGISTRY_PREFIX}${server.name}`,
    name: server.title ?? short,
    publisher: namespace || "Community",
    category: "Community",
    description: server.description ?? "",
    kind: plan?.template.transport ?? (server.remotes?.length ? "remote" : "local"),
    auth: fields.some((f) => f.secret) ? "token" : "none",
    setup: {
      fields,
      docsUrl: server.websiteUrl ?? server.repository?.url,
      ...(plan
        ? {}
        : { steps: ["OpenBot cannot run this server yet (no npm, PyPI, or HTTPS endpoint)."] }),
    },
    verified: false,
    connected: connectionId !== undefined,
    ...(connectionId ? { connectionId } : {}),
  };
}
