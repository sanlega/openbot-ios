/** Vault key naming for connector secrets (plan E4 — never in DB/logs/events). */

/** Prefix of every vault key that belongs to one connection. */
export function connectionKeyPrefix(connectionId: string): string {
  return `connection.${connectionId}.`;
}

/** Non-secret setup (catalogue id, plain values, registry template) as JSON. */
export function connectionMcpConfigKey(connectionId: string): string {
  return `connection.${connectionId}.mcpConfig`;
}

/** One secret setup value (a token, a client secret). */
export function connectionEnvKey(connectionId: string, key: string): string {
  return `connection.${connectionId}.env.${key}`;
}
