/** Vault key naming for connector secrets (plan E4 — never in DB/logs/events). */

export const COMPOSIO_API_KEY = "composio.apiKey";

export function composioOAuthAppKeys(appId: string): { clientId: string; clientSecret: string } {
  const base = `composio.oauth.${appId}`;
  return { clientId: `${base}.clientId`, clientSecret: `${base}.clientSecret` };
}

export function connectionSecretKey(connectionId: string): string {
  return `connection.${connectionId}.secret`;
}

export function connectionMcpConfigKey(connectionId: string): string {
  return `connection.${connectionId}.mcpConfig`;
}

export function connectionEnvKey(connectionId: string, envName: string): string {
  return `connection.${connectionId}.env.${envName}`;
}
