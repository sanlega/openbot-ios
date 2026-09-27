import type { FastifyInstance } from "fastify";
import type { CoreContext } from "../../context.js";

export const SERVER_VERSION = "0.1.0";

export function registerHealthRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/harness/status", async () => ({
    connected: true,
    version: SERVER_VERSION,
  }));

  app.get("/api/engines", async () => {
    const statuses = ctx.engineStatuses ?? {};
    const engines = Object.entries(statuses).map(([id, status]) => ({
      id,
      ...status,
      available:
        ctx.availableEngines?.includes(id as (typeof ctx.availableEngines)[number]) ?? false,
    }));
    return { engines };
  });

  app.get("/api/models", async () => {
    return { engines: (await ctx.listModels?.()) ?? [] };
  });
}
