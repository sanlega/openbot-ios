import type { FastifyInstance, FastifyPluginCallback, FastifyPluginAsync } from "fastify";
import type { CoreContext, SetupValidator, SetupValidatorKind } from "./context.js";

/**
 * The module host (plan §3/§5 WS1: "lets other workstreams register routes,
 * e.g. WS12's `/hooks`"). Other workstreams never reach into `packages/core`'s
 * Fastify instance directly — they get one handed to them here, plus a place
 * to plug in a setup-wizard validator, so `packages/core` stays the only
 * package that constructs the HTTP server.
 *
 * Known call sites once those workstreams land: WS12 registers
 * `POST /hooks/:routineId`; WS4 registers `POST /internal/tools/:name`; WS3/
 * WS10/WS11 register `claude_login`/`codex_login`/`tailscale`/
 * `cloudflare` validators.
 */
export interface ModuleHost {
  /** Thin wrapper over `FastifyInstance.register` — the plugin receives the same `CoreContext` this host was built from. */
  registerRoutes(
    plugin: FastifyPluginAsync | FastifyPluginCallback,
    opts?: Record<string, unknown>,
  ): void;
  registerValidator(kind: SetupValidatorKind, validator: SetupValidator): void;
  readonly app: FastifyInstance;
  readonly ctx: CoreContext;
}

export function createModuleHost(app: FastifyInstance, ctx: CoreContext): ModuleHost {
  return {
    app,
    ctx,
    registerRoutes(plugin, opts) {
      if (opts) {
        void app.register(plugin as FastifyPluginAsync, opts);
      } else {
        void app.register(plugin as FastifyPluginAsync);
      }
    },
    registerValidator(kind, validator) {
      ctx.validators[kind] = validator;
    },
  };
}
