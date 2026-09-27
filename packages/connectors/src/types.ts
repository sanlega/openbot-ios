import { z } from "zod";

/** Manual MCP server config persisted in the vault (non-secret fields + env key names). */
export const StoredMcpConfig = z.object({
  transport: z.enum(["stdio", "http"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  /** Env var names whose values live in the vault under `connection.{id}.env.{name}`. */
  secretEnvKeys: z.array(z.string()).default([]),
});
export type StoredMcpConfig = z.infer<typeof StoredMcpConfig>;

export const ConnectRequest = z.object({
  provider: z.enum(["mcp", "composio"]),
  appId: z.string().min(1),
  displayName: z.string().optional(),
  mcpConfig: StoredMcpConfig.extend({
    env: z.record(z.string(), z.string()).optional(),
  }).optional(),
});
export type ConnectRequest = z.infer<typeof ConnectRequest>;

/** Namespaced catalog ids: `mcp:…` or `composio:…`. */
export function parseCatalogId(catalogId: string): { provider: string; appId: string } {
  const idx = catalogId.indexOf(":");
  if (idx <= 0) return { provider: "unknown", appId: catalogId };
  return { provider: catalogId.slice(0, idx), appId: catalogId.slice(idx + 1) };
}

export function catalogId(provider: string, appId: string): string {
  return `${provider}:${appId}`;
}
