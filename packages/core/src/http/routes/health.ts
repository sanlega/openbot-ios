import type { FastifyInstance } from "fastify";
import type { CoreContext } from "../../context.js";

export const SERVER_VERSION = "0.1.0";

export function registerHealthRoutes(app: FastifyInstance, _ctx: CoreContext): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/harness/status", async () => ({
    connected: true,
    version: SERVER_VERSION,
  }));

  app.get("/api/engines", async () => {
    // WS3 populates real engine statuses; nothing is wired in yet on WS1 alone.
    return { engines: [] as unknown[] };
  });

  app.get("/api/models", async () => {
    return { models: [] as unknown[] };
  });
}
