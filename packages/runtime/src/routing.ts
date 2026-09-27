import type { Band, EngineId } from "@openbot/contracts";

/**
 * Per-turn routing hook (plan §5 WS2: "within the same engine, a model or
 * effort switch is allowed; switching engines needs the `auto` band and
 * seeds a new session"). The actual engine/model *choice* is Jev's `route`
 * decision (WS7); this hook only enforces WHEN a requested route can take
 * effect for the NEXT turn, given the currently running session.
 */
export interface RouteRequest {
  currentEngine?: EngineId;
  currentSessionId?: string;
  requestedEngine: EngineId;
  requestedModel: string;
  requestedEffort?: "low" | "medium" | "high";
  /** The Jev `route` decision's band — only consulted when `requestedEngine` differs from `currentEngine`. */
  band?: Band;
}

export interface RouteResult {
  engine: EngineId;
  model: string;
  effort?: "low" | "medium" | "high";
  /** Carries over the current session id, or `undefined` when a new session must be seeded. */
  sessionId?: string;
  seededNewSession: boolean;
  /** Set when an engine switch was requested but refused (band wasn't `auto`) — the turn stays on `currentEngine`. */
  refused?: string;
}

export function resolveRoute(req: RouteRequest): RouteResult {
  const switchingEngine =
    req.currentEngine !== undefined && req.currentEngine !== req.requestedEngine;

  if (!switchingEngine) {
    return {
      engine: req.requestedEngine,
      model: req.requestedModel,
      effort: req.requestedEffort,
      sessionId: req.currentSessionId,
      seededNewSession: false,
    };
  }

  if (req.band !== "auto") {
    return {
      engine: req.currentEngine as EngineId,
      model: req.requestedModel,
      effort: req.requestedEffort,
      sessionId: req.currentSessionId,
      seededNewSession: false,
      refused: `engine switch (${req.currentEngine} -> ${req.requestedEngine}) needs Jev band 'auto', got ${req.band ?? "none"}`,
    };
  }

  return {
    engine: req.requestedEngine,
    model: req.requestedModel,
    effort: req.requestedEffort,
    sessionId: undefined,
    seededNewSession: true,
  };
}
