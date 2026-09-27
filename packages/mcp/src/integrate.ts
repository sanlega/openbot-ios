import type { FastifyInstance } from "fastify";
import type { CoreContext, Vault } from "@openbot/core";
import { registerInternalToolRoutes } from "./http/register.js";
import { createFakeMcpServices } from "./services/fakes.js";
import type { McpToolServices } from "./services/interfaces.js";
import { SessionTokenService, generateSessionSecret } from "./session-token.js";

const VAULT_SESSION_SECRET_KEY = "mcp.sessionTokenSecret";

export interface IntegrateMcpOptions {
  services?: McpToolServices;
  secret?: Buffer;
}

let cachedServices: McpToolServices | undefined;

/**
 * Wires WS4 into a running harness: internal tool routes plus default fakes for
 * workstreams that have not landed yet.
 */
export async function integrateMcp(
  app: FastifyInstance,
  ctx: CoreContext,
  options: IntegrateMcpOptions = {},
): Promise<{ tokens: SessionTokenService; services: McpToolServices }> {
  const secret = options.secret ?? (await loadOrCreateSessionSecret(ctx.vault));
  const tokens = new SessionTokenService(secret);
  const services = options.services ?? cachedServices ?? createFakeMcpServices();
  cachedServices = services;

  registerInternalToolRoutes(app, ctx, { tokens, services });
  return { tokens, services };
}

async function loadOrCreateSessionSecret(vault: Vault): Promise<Buffer> {
  const existing = await vault.get(VAULT_SESSION_SECRET_KEY);
  if (existing) return Buffer.from(existing, "hex");
  const secret = generateSessionSecret();
  await vault.set(VAULT_SESSION_SECRET_KEY, secret.toString("hex"));
  return secret;
}
