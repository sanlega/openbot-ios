import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { getPwaStaticRoot } from "@openbot/pwa";
import { attachRemoteServices, E2E_CONTENT_TYPE, registerRemoteIntegration } from "@openbot/remote";
import type { CoreContext } from "../context.js";
import { resolveDeviceIdentity, resolveSealedDeviceIdentity } from "./auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerBotRoutes } from "./routes/bots.js";
import { registerInputRoutes } from "./routes/inputs.js";
import { registerLoginRoutes } from "./routes/logins.js";
import { registerThreadRoutes } from "./routes/threads.js";
import { registerSafetyRoutes } from "./routes/safety.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerSettingsAndSetupRoutes } from "./routes/settings-setup.js";
import { registerComputerRoutes } from "./routes/computer.js";
import { registerConnectorRoutes } from "./routes/connectors.js";
import { registerRoutineRoutes } from "./routes/routines.js";
import { registerRemoteAndAuditRoutes } from "./routes/remote-and-audit.js";
import { registerWebSocketRoute } from "../ws.js";

export interface BuildServerOptions {
  /** When false, skips WS11 remote wiring (legacy unit tests that mock pairing directly). */
  wireRemote?: boolean;
  pwaRoot?: string;
}

/**
 * Assembles the Client API (plan §4.7) into one Fastify instance: every WS1
 * HTTP route module plus the `/api/ws` WebSocket route, sharing the same
 * `CoreContext`. This is the single place `apps/server` (headless `openbot
 * serve`) and `apps/desktop` (Electron `utilityProcess`) both call into, so
 * neither has to know how the route modules are wired together.
 */
export async function buildServer(
  ctx: CoreContext,
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyWebsocket);

  // Uploads (`POST /api/uploads`, threads.ts) send raw bytes, not JSON or a
  // form — teach Fastify to hand the handler a Buffer instead of trying (and
  // failing) to JSON-parse the body.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, payload, done) => done(null, payload),
  );
  app.addContentTypeParser(E2E_CONTENT_TYPE, { parseAs: "string" }, (_request, payload, done) =>
    done(null, payload),
  );
  app.addContentTypeParser("*", { parseAs: "buffer" }, (request, payload, done) => {
    if (request.url === "/api/uploads") {
      done(null, payload);
      return;
    }
    if (payload.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(payload.toString("utf8")));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  // Resolves `request.device` before any handler runs (plan §4.8: loopback is
  // implicitly the owner with no token; a non-loopback request needs a valid
  // bearer token or gets no identity, which every route's `requireAuth`/
  // `requireOwner` then rejects with 401).
  app.addHook("onRequest", async (request) => {
    const hasSealedDeviceCredential =
      request.headers["x-openbot-device"] !== undefined ||
      request.headers["x-openbot-device-token"] !== undefined;
    request.device = hasSealedDeviceCredential
      ? await resolveSealedDeviceIdentity(ctx, request)
      : resolveDeviceIdentity(ctx, request);
  });

  registerHealthRoutes(app, ctx);
  registerBotRoutes(app, ctx);
  registerInputRoutes(app, ctx);
  registerLoginRoutes(app, ctx);
  registerThreadRoutes(app, ctx);
  registerSafetyRoutes(app, ctx);
  registerDeviceRoutes(app, ctx);
  registerSettingsAndSetupRoutes(app, ctx);
  registerComputerRoutes(app, ctx);
  registerConnectorRoutes(app, ctx);
  registerRoutineRoutes(app, ctx);
  registerRemoteAndAuditRoutes(app, ctx);
  registerWebSocketRoute(app, ctx);

  if (options.wireRemote !== false) {
    await attachRemoteServices(ctx);
    await registerRemoteIntegration(app, ctx, options.pwaRoot ?? getPwaStaticRoot());
  }

  return app;
}
