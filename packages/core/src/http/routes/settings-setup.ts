import type { FastifyInstance } from "fastify";
import type { Settings } from "@openbot/contracts";
import type { CoreContext, SetupValidatorKind } from "../../context.js";
import { requireAuth, requireOwner } from "../auth.js";
import { parseOrReject } from "../validation.js";
import { SetupValidateBody, UpdateSettingsBody } from "../schemas.js";

const DEFAULT_CAPS: Settings["caps"] = {
  s1_cosBotsCap: 6,
  s2_newBotsPer24h: 2,
  s3_spawnCooldownMin: 30,
  s4_proactivePerBotPerHour: 3,
  s4_proactivePerBotPerDay: 8,
  s5_proactiveAllBotsPerHour: 6,
  s6_dedupeWindowHours: 6,
  s10_mergeWindowMin: 10,
};
const DEFAULT_BUDGETS: Settings["budgets"] = { gates: 250, interactive: 200, computer: 450, background: 100 };

function defaultSettings(ctx: CoreContext): Settings {
  return {
    id: "singleton",
    caps: DEFAULT_CAPS,
    budgets: DEFAULT_BUDGETS,
    updatedAt: ctx.clock.now().toISOString(),
  };
}

/** Settings (caps S1-S10/O7, budgets, quiet hours) and the setup wizard (plan §4.7). Owner-only writes. */
export function registerSettingsAndSetupRoutes(app: FastifyInstance, ctx: CoreContext): void {
  app.get("/api/settings", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    return { settings: ctx.repos.settings.get() ?? defaultSettings(ctx) };
  });

  app.put("/api/settings", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const body = parseOrReject(UpdateSettingsBody, request.body, reply);
    if (!body) return;

    const current: Settings = ctx.repos.settings.get() ?? defaultSettings(ctx);
    const next: Settings = {
      ...current,
      caps: { ...current.caps, ...body.caps },
      budgets: { ...current.budgets, ...body.budgets },
      quietHours: body.quietHours ?? current.quietHours,
      updatedAt: ctx.clock.now().toISOString(),
    };
    ctx.repos.settings.upsert(next);
    await ctx.eventBus.publish({ type: "setup.changed", payload: { settings: next } });
    return { settings: next };
  });

  app.get("/api/setup", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return { setup: ctx.repos.setupState.get() };
  });

  app.post("/api/setup/validate", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const body = parseOrReject(SetupValidateBody, request.body, reply);
    if (!body) return;

    const result = await validate(ctx, body.kind, body.value);
    const setup = ctx.repos.setupState.patch(patchFor(body.kind, result));
    await ctx.eventBus.publish({ type: "setup.changed", payload: { kind: body.kind, result } });
    return { result, setup };
  });
}

async function validate(
  ctx: CoreContext,
  kind: SetupValidatorKind,
  value: string | undefined,
): Promise<{ ok: boolean; reason?: string; rpmLimit?: number }> {
  if (kind === "typesafe") {
    if (!ctx.decisionService) return { ok: false, reason: "DecisionService not wired yet (WS7)" };
    return ctx.decisionService.validateKey(value ?? "");
  }
  const validator = ctx.validators[kind];
  if (!validator) return { ok: false, reason: `no validator registered for "${kind}" yet` };
  return validator(value);
}

function patchFor(
  kind: SetupValidatorKind,
  result: { ok: boolean; reason?: string },
): Parameters<CoreContext["repos"]["setupState"]["patch"]>[0] {
  switch (kind) {
    case "typesafe":
      return { typesafe: { ok: result.ok } };
    case "anthropic":
      return { claude: { ok: result.ok, mode: "api_key" } };
    case "claude_login":
      return { claude: { ok: result.ok, mode: "login" } };
    case "openai":
      return { codex: { ok: result.ok, mode: "api_key" } };
    case "codex_login":
      return { codex: { ok: result.ok, mode: "login" } };
    case "composio":
      return { composio: { ok: result.ok } };
    case "tailscale":
      return { tailscale: { ok: result.ok } };
    case "cloudflare":
      return { cloudflare: { ok: result.ok } };
  }
}
