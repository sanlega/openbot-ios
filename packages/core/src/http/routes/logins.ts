import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CoreContext } from "../../context.js";
import { listLogins, removeLogin, saveLogin, siteKey } from "../../logins.js";
import { requireOwner } from "../auth.js";

/**
 * Saved website logins (owner only). The list never contains a password, and no route returns
 * one: the host types it into the virtual machine when a Bot's task reaches a login form.
 */
export function registerLoginRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/logins", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    return { logins: await listLogins(ctx.vault) };
  });

  app.put("/api/logins/:site", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const site = siteParam(request, reply);
    if (!site) return;
    const body = (request.body ?? {}) as { username?: unknown; password?: unknown };
    const text = (value: unknown) =>
      typeof value === "string" && value.trim() !== "" ? value : undefined;
    const saved = await saveLogin(
      ctx.vault,
      site,
      { username: text(body.username), password: text(body.password) },
      ctx.clock.now(),
    );
    if (!saved.ok) return reply.code(400).send({ error: "invalid_login", reason: saved.reason });
    return { login: (await listLogins(ctx.vault)).find((l) => l.site === saved.site) };
  });

  app.delete("/api/logins/:site", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const site = siteParam(request, reply);
    if (!site) return;
    const key = siteKey(site);
    if (!key || !(await removeLogin(ctx.vault, key))) {
      return reply.code(404).send({ error: "not_found" });
    }
    return { ok: true };
  });
}

/** The `:site` path parameter, decoded; a malformed one is a 400, not a crash. */
function siteParam(request: FastifyRequest, reply: FastifyReply): string | undefined {
  try {
    return decodeURIComponent((request.params as { site: string }).site);
  } catch {
    void reply.code(400).send({ error: "invalid_login", reason: "that isn't a website address" });
    return undefined;
  }
}
