/** Loopback OAuth callback and desktop deep-link helpers (WS10). */

export interface OAuthCallbackQuery {
  connectionId: string;
  state: string;
  code?: string;
}

export function buildOAuthCallbackUrl(port: number, connectionId: string, state: string): string {
  const params = new URLSearchParams({ connectionId, state });
  return `http://127.0.0.1:${port}/api/connectors/oauth/callback?${params.toString()}`;
}

export function buildOpenBotOAuthDeepLink(connectionId: string): string {
  const params = new URLSearchParams({ connectionId });
  return `openbot://connectors/oauth/complete?${params.toString()}`;
}

export function parseOAuthCallbackQuery(
  query: Record<string, unknown>,
): OAuthCallbackQuery | undefined {
  const connectionId = typeof query.connectionId === "string" ? query.connectionId : undefined;
  const state = typeof query.state === "string" ? query.state : undefined;
  if (!connectionId || !state) return undefined;
  const code = typeof query.code === "string" ? query.code : undefined;
  return { connectionId, state, code };
}

export function oauthCallbackSuccessHtml(connectionId: string, appName: string): string {
  const deepLink = buildOpenBotOAuthDeepLink(connectionId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${appName} connected</title>
  <meta http-equiv="refresh" content="0;url=${deepLink}" />
</head>
<body>
  <p><strong>${appName}</strong> is connected. Returning to OpenBot…</p>
  <p>If the app does not open automatically, <a href="${deepLink}">click here</a>.</p>
</body>
</html>`;
}
