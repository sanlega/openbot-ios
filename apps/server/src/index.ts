import Fastify, { type FastifyInstance } from "fastify";

export const SERVER_VERSION = "0.1.0";

/**
 * Minimal headless-shell boot (plan §3/§5 WS1: `apps/server`, `openbot
 * serve|doctor|pair`). WS0's scope is just standing up a bootable server with
 * a health/status endpoint the desktop shell can poll to show "harness
 * connected" (the WS0 acceptance criterion); WS1 owns the real Client API
 * (plan §4.7), WebSocket, and `serve|doctor|pair` CLI subcommands.
 */
export function createServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/harness/status", async () => ({
    connected: true,
    version: SERVER_VERSION,
  }));

  return app;
}
