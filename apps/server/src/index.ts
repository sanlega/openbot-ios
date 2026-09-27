import type { FastifyInstance } from "fastify";
import {
  buildServer,
  createCoreContext,
  type CoreContext,
  type CreateCoreContextOptions,
} from "@openbot/core";

export const SERVER_VERSION = "0.1.0";

/**
 * Boots one Client API server backed by a fresh `CoreContext` (plan §5 WS1:
 * `apps/server` is the headless host for `@openbot/core`). `openbot serve`
 * (`cli.ts`) calls `createCoreContext`/`buildServer` directly instead, since
 * it also needs to resolve the bind host and log the listening address —
 * this helper exists so tests and `apps/desktop` don't need their own
 * `@openbot/core` wiring.
 */
export async function createServer(
  options?: CreateCoreContextOptions,
): Promise<{ app: FastifyInstance; ctx: CoreContext }> {
  const ctx = await createCoreContext(options);
  const app = await buildServer(ctx);
  return { app, ctx };
}

export { runCli } from "./cli.js";
