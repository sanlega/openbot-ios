import type { CloudflareStartResult } from "./cloudflare-manager.js";
import { normalizeTunnelToken } from "./cloudflare-manager.js";
import type { RemoteCoreContext } from "./integration.js";
import { writeNetworkPrefs } from "./network-prefs.js";

/** The owner's tunnel token lives only in the vault; no API ever returns it. */
export const CLOUDFLARE_TOKEN_VAULT_KEY = "remote.cloudflareTunnelToken";

/** The slice of the core context these helpers need. */
export type CloudflareTunnelContext = RemoteCoreContext & {
  vault: RemoteCoreContext["vault"] & { delete(key: string): Promise<void> };
};

export async function hasCloudflareToken(ctx: CloudflareTunnelContext): Promise<boolean> {
  return Boolean(await ctx.vault.get(CLOUDFLARE_TOKEN_VAULT_KEY));
}

async function publishStatus(
  ctx: CloudflareTunnelContext,
  result: CloudflareStartResult,
): Promise<void> {
  ctx.repos.setupState.patch({ cloudflare: { ok: result.ok } });
  if (!result.ok) return;
  await ctx.eventBus.publish({
    type: "remote.status",
    payload: {
      cloudflare: {
        enabled: true,
        hostname: result.hostname,
        accessWarning: result.accessWarning,
      },
    },
  });
}

/**
 * Starts the tunnel. With a `token` (the owner just pasted one) it is saved to the vault once the
 * tunnel comes up, replacing any earlier one; without, the saved token is used.
 */
export async function startCloudflareTunnel(
  ctx: CloudflareTunnelContext,
  token?: string,
): Promise<CloudflareStartResult> {
  if (!ctx.remote) return { ok: false, reason: "remote access isn't available" };
  const given = token?.trim() ? token : undefined;
  const candidate = given ?? (await ctx.vault.get(CLOUDFLARE_TOKEN_VAULT_KEY));
  if (!candidate) return { ok: false, reason: "no saved tunnel token" };

  const result = await ctx.remote.cloudflare.start(candidate);
  if (result.ok && given) {
    await ctx.vault.set(CLOUDFLARE_TOKEN_VAULT_KEY, normalizeTunnelToken(given) ?? given);
  }
  await publishStatus(ctx, result);
  return result;
}

/** Stops the tunnel and forgets the token and its public hostname. */
export async function removeCloudflareTunnel(ctx: CloudflareTunnelContext): Promise<void> {
  if (ctx.remote) {
    await ctx.remote.cloudflare.stop();
    ctx.remote.cloudflare.forget();
  }
  await ctx.vault.delete(CLOUDFLARE_TOKEN_VAULT_KEY);
  await writeNetworkPrefs(ctx.config.openbotHome, { cloudflareHostname: undefined });
  ctx.repos.setupState.patch({ cloudflare: { ok: false } });
  await ctx.eventBus.publish({
    type: "remote.status",
    payload: { cloudflare: { enabled: false } },
  });
}

/** At server start: bring the tunnel back up if the owner configured one. Never throws. */
export async function resumeCloudflareTunnel(
  ctx: CloudflareTunnelContext,
): Promise<CloudflareStartResult | undefined> {
  try {
    if (!(await hasCloudflareToken(ctx))) return undefined;
    return await startCloudflareTunnel(ctx);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
