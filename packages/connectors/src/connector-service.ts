import { z } from "zod";
import type {
  CatalogEntry,
  Connection,
  ConnectionView,
  ConnectorSetupField,
  ConnectorSource,
  McpServerSpec,
} from "@openbot/contracts";
import { newId } from "@openbot/contracts";
import {
  ConnectorError,
  type ConnectorConnectInput,
  type ConnectorService,
  type ConnectorToolClass,
  type CoreContext,
} from "@openbot/core";
import {
  CURATED_CONNECTORS,
  CURATED_PREFIX,
  curatedById,
  toCatalogEntry,
  type ConnectorTemplate,
} from "./catalog/curated.js";
import { renderServer } from "./catalog/template.js";
import {
  REGISTRY_PREFIX,
  registryEntry,
  registryPlan,
  type McpRegistryClient,
} from "./mcp-registry.js";
import { connectionEnvKey, connectionKeyPrefix, connectionMcpConfigKey } from "./vault-keys.js";

/** Non-secret part of a connection's setup, stored in the vault (never in the DB). */
const StoredConfig = z.object({
  catalogId: z.string(),
  /** Plain (non-secret) setup values, e.g. a folder path. */
  values: z.record(z.string(), z.string()).default({}),
  /** Keys of secret values stored under `connectionEnvKey`. */
  secretKeys: z.array(z.string()).default([]),
  /** Registry servers only: the template resolved at connect time (curated ones use the live catalogue). */
  template: z.custom<ConnectorTemplate>().optional(),
});
type StoredConfig = z.infer<typeof StoredConfig>;

/** Server names engines see; `openbot` is OpenBot's own server. */
const RESERVED_SERVER_NAMES = new Set(["openbot"]);

export function newConnectionId(): string {
  return newId("connection");
}

export interface ConnectorServiceDeps {
  ctx: CoreContext;
  registry: McpRegistryClient;
}

/**
 * Connectors as plain MCP servers (D-019): a curated catalogue plus MCP
 * Registry entries, connected with setup values (secrets only in the vault),
 * assigned per Bot, and injected into that Bot's turns.
 */
export class DefaultConnectorService implements ConnectorService {
  constructor(private readonly deps: ConnectorServiceDeps) {}

  private get ctx(): CoreContext {
    return this.deps.ctx;
  }

  async catalog(
    source: ConnectorSource,
    q: string,
  ): Promise<{ entries: CatalogEntry[]; error?: string }> {
    const connectedBy = new Map<string, string>();
    for (const c of this.ctx.repos.connections.list()) {
      if (!connectedBy.has(c.appId)) connectedBy.set(c.appId, c.id);
    }

    if (source === "curated") {
      const needle = q.trim().toLowerCase();
      const entries = CURATED_CONNECTORS.filter(
        (c) =>
          !needle ||
          [c.name, c.publisher, c.category, c.description, c.slug].some((t) =>
            t.toLowerCase().includes(needle),
          ),
      ).map((c) => toCatalogEntry(c, connectedBy.get(`${CURATED_PREFIX}${c.slug}`)));
      return { entries };
    }

    try {
      const servers = await this.deps.registry.search(q);
      return {
        entries: servers.map((s) =>
          registryEntry(s, connectedBy.get(`${REGISTRY_PREFIX}${s.name}`)),
        ),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { entries: [], error: `MCP Registry unavailable: ${reason}` };
    }
  }

  async connect(input: ConnectorConnectInput): Promise<ConnectionView> {
    const resolved = await this.resolveEntry(input.catalogId);
    const { entry, template } = resolved;
    if (entry.auth === "oauth") {
      throw new ConnectorError(
        "oauth_not_supported_yet",
        `${entry.name} needs OAuth sign-in, which is coming soon.`,
        409,
      );
    }

    const fields = entry.setup?.fields ?? [];
    const values = trimValues(input.values);
    const missing = fields.filter((f) => !f.optional && !values[f.key]).map((f) => f.key);
    if (missing.length > 0) {
      throw new ConnectorError(
        "missing_fields",
        `Missing ${missing.join(", ")} for ${entry.name}.`,
        400,
        missing,
      );
    }

    const id = newConnectionId();
    const plain: Record<string, string> = {};
    const secretKeys: string[] = [];
    for (const field of fields) {
      const value = values[field.key];
      if (!value) continue;
      if (field.secret) {
        await this.ctx.vault.set(connectionEnvKey(id, field.key), value);
        secretKeys.push(field.key);
      } else {
        plain[field.key] = value;
      }
    }
    const config: StoredConfig = {
      catalogId: entry.id,
      values: plain,
      secretKeys,
      ...(resolved.source === "community" ? { template } : {}),
    };
    await this.ctx.vault.set(connectionMcpConfigKey(id), JSON.stringify(config));

    const connection: Connection = {
      id,
      provider: "mcp",
      appId: entry.id,
      displayName: input.displayName ?? entry.name,
      status: "connected",
      toolMeta: Object.fromEntries(
        (entry.tools ?? []).map((t) => [t.name, { sideEffect: t.write }]),
      ),
      triggers: [],
      createdAt: this.ctx.clock.now().toISOString(),
    };
    this.ctx.repos.connections.create(connection);
    await this.ctx.eventBus.publish({
      type: "connector.connected",
      payload: { connectionId: id, catalogId: entry.id, name: connection.displayName },
    });
    return toView(connection);
  }

  listConnections(): ConnectionView[] {
    return this.ctx.repos.connections.list().map(toView);
  }

  async disconnect(connectionId: string): Promise<boolean> {
    const connection = this.ctx.repos.connections.getById(connectionId);
    if (!connection) return false;

    const prefix = connectionKeyPrefix(connectionId);
    for (const key of await this.ctx.vault.list()) {
      if (key.startsWith(prefix)) await this.ctx.vault.delete(key);
    }
    this.ctx.repos.connections.delete(connectionId);

    for (const bot of this.ctx.repos.bots.list()) {
      if (!bot.connectors.includes(connectionId)) continue;
      const patch = { connectors: bot.connectors.filter((c) => c !== connectionId) };
      this.ctx.repos.bots.update(bot.id, patch);
      await this.ctx.eventBus.publish({
        type: "bot.updated",
        botId: bot.id,
        payload: { patch, bot: this.ctx.repos.bots.getById(bot.id) },
      });
    }
    await this.ctx.eventBus.publish({
      type: "connector.disconnected",
      payload: { connectionId, catalogId: connection.appId },
    });
    return true;
  }

  async mcpServersForBot(botId: string): Promise<McpServerSpec[]> {
    const specs: McpServerSpec[] = [];
    for (const { connection, serverName } of this.botServers(botId)) {
      const raw = await this.ctx.vault.get(connectionMcpConfigKey(connection.id));
      if (!raw) continue;
      const config = StoredConfig.parse(JSON.parse(raw));
      const template = curatedById(config.catalogId)?.template ?? config.template;
      if (!template) continue;
      const values: Record<string, string> = { ...config.values };
      for (const key of config.secretKeys) {
        const value = await this.ctx.vault.get(connectionEnvKey(connection.id, key));
        if (value) values[key] = value;
      }
      specs.push(renderServer(serverName, template, values));
    }
    return specs;
  }

  classifyTool(botId: string, toolName: string, input?: unknown): ConnectorToolClass | undefined {
    const servers = this.botServers(botId);
    if (servers.length === 0) return undefined;
    const match = matchTool(
      toolName,
      input,
      servers.map((s) => s.serverName),
    );
    if (!match) return undefined;
    const { connection } = servers.find((s) => s.serverName === match.server)!;
    const curatedTools = curatedById(connection.appId)?.tools;
    const known = curatedTools
      ? curatedTools.find((t) => t.name === match.tool)?.write
      : connection.toolMeta[match.tool]?.sideEffect;
    // Tools the catalogue does not list are treated as writes.
    const write = known ?? true;
    return {
      kind: "connector_action",
      action: match.tool,
      target: connection.displayName,
      sideEffect: write,
      readOnly: !write,
      summary: `${connection.displayName}: ${match.tool}`,
    };
  }

  /** The Bot's connected connections with the MCP server name each gets in its turns. */
  private botServers(botId: string): Array<{ connection: Connection; serverName: string }> {
    const bot = this.ctx.repos.bots.getById(botId);
    if (!bot) return [];
    const used = new Set<string>(RESERVED_SERVER_NAMES);
    const out: Array<{ connection: Connection; serverName: string }> = [];
    for (const connectionId of bot.connectors) {
      const connection = this.ctx.repos.connections.getById(connectionId);
      if (!connection || connection.status !== "connected") continue;
      // A browser-automation server opens a browser on the owner's computer. A Bot whose computer
      // is the virtual machine never gets one: its browser work goes through computer_task.
      if (bot.computer !== "docker+local" && drivesHostBrowser(connection)) continue;
      const base = serverBaseName(connection.appId);
      let name = base;
      for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
      used.add(name);
      out.push({ connection, serverName: name });
    }
    return out;
  }

  private async resolveEntry(catalogId: string): Promise<{
    entry: CatalogEntry;
    template: ConnectorTemplate;
    source: ConnectorSource;
  }> {
    const curated = curatedById(catalogId);
    if (curated) {
      return { entry: toCatalogEntry(curated), template: curated.template, source: "curated" };
    }
    if (catalogId.startsWith(REGISTRY_PREFIX)) {
      const server = await this.deps.registry.get(catalogId.slice(REGISTRY_PREFIX.length));
      if (server) {
        const plan = registryPlan(server);
        if (!plan) {
          throw new ConnectorError(
            "unsupported_server",
            `OpenBot cannot run ${server.name} yet (no npm, PyPI, or HTTPS endpoint).`,
            409,
          );
        }
        return { entry: registryEntry(server), template: plan.template, source: "community" };
      }
    }
    throw new ConnectorError("unknown_catalog_entry", `Unknown connector "${catalogId}".`, 404);
  }
}

function trimValues(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const trimmed = value.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

function toView(connection: Connection): ConnectionView {
  return {
    id: connection.id,
    catalogId: connection.appId,
    name: connection.displayName,
    status: connection.status,
    createdAt: connection.createdAt,
  };
}

/** `curated:github` → `github`; `registry:io.github.acme/weather` → `weather`. */
export function serverBaseName(catalogId: string): string {
  const raw = catalogId.startsWith(CURATED_PREFIX)
    ? catalogId.slice(CURATED_PREFIX.length)
    : (catalogId.split("/").pop() ?? catalogId);
  const name = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "connector";
}

/**
 * Which connector server and tool an engine's tool call targets. Claude names
 * MCP tools `mcp__<server>__<tool>`; other engines may send the server and
 * tool as fields of the approval input, or `<server>.<tool>`.
 */
export function matchTool(
  toolName: string,
  input: unknown,
  serverNames: string[],
): { server: string; tool: string } | undefined {
  const claude = /^mcp__(.+?)__(.+)$/.exec(toolName);
  if (claude && serverNames.includes(claude[1]!)) return { server: claude[1]!, tool: claude[2]! };

  const args = (input ?? {}) as Record<string, unknown>;
  if (typeof args.server === "string" && typeof args.tool === "string") {
    if (serverNames.includes(args.server)) return { server: args.server, tool: args.tool };
  }

  for (const server of serverNames) {
    for (const sep of ["__", ".", "/"]) {
      if (toolName.startsWith(`${server}${sep}`)) {
        return { server, tool: toolName.slice(server.length + sep.length) };
      }
    }
  }
  return undefined;
}

export type { ConnectorService, ConnectorSetupField };

/** Playwright, Puppeteer, Selenium, Browserbase-style local servers: they drive a browser on this computer. */
const HOST_BROWSER_SERVER_RE =
  /playwright|puppeteer|selenium|chrome-devtools|browser-?use|webdriver/i;

export function drivesHostBrowser(connection: Pick<Connection, "appId" | "displayName">): boolean {
  const template = curatedById(connection.appId)?.template;
  const command =
    template && template.transport === "local"
      ? `${template.command} ${(template.args ?? []).join(" ")}`
      : "";
  return HOST_BROWSER_SERVER_RE.test(`${connection.appId} ${connection.displayName} ${command}`);
}
