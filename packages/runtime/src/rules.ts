import type { Rule, RuleEffect } from "@openbot/contracts";
import { newId } from "@openbot/contracts";
import type { BrokerRequest } from "./broker-types.js";

/**
 * Permission broker rule engine (plan §4.6/WS2 E6). Three rule sources are
 * merged and matched together: `builtin` (the "ask" half of E6 — sensitive
 * computer targets, side-effecting connector actions, local-machine actions;
 * the "deny" half of E6 — credential paths, the DB/vault, `sudo`, `rm -rf`
 * outside the workspace — is a separate, non-overridable pass, see
 * {@link builtinDenyReason}), `preset` (derived from the Bot's
 * `permissionPreset`), and `user` (stored in a {@link RuleStore}, e.g.
 * "always allow this tool" clicks from an approval card).
 *
 * Precedence across ALL matching rules regardless of source: `deny` beats
 * `ask` beats `allow` — this is what makes "a deny rule beats an always-allow
 * rule" and "clicking a Pay target always raises a card" both true from one
 * simple rule (plan §5 WS2 acceptance).
 */

const CREDENTIAL_PATH_RE =
  /(\.ssh\/|\.aws[/\\]credentials|\.npmrc|id_rsa|\.pem(\s|$)|credentials\.json|\bkeychain\b|secrets?\.json|\.git-credentials)/i;
const DB_OR_VAULT_RE = /(openbot\.db|vault\.bin|\.openbot[/\\](db|vault))/i;
const SUDO_RE = /\bsudo\b/i;
const RM_RF_RE = /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\b/i;

/** plan §5 WS2: "sensitive computer targets" — matched against a computer action's observed element label. */
export const SENSITIVE_COMPUTER_TARGET_RE = /pay|buy|send|delete|transfer|submit order|confirm/i;

function haystackOf(req: BrokerRequest): string {
  return [req.action, req.target, req.detail, req.summary, JSON.stringify(req.args ?? {})].join(
    " \u241F ",
  );
}

/**
 * The non-overridable half of E6 ("built-in deny"): no rule, preset, or Jev
 * band can ever turn this back into an allow. Returns the reason, or
 * `undefined` if nothing built-in denies this request.
 */
export function builtinDenyReason(req: BrokerRequest): string | undefined {
  const haystack = haystackOf(req);
  if (CREDENTIAL_PATH_RE.test(haystack)) return "targets a credential path";
  if (DB_OR_VAULT_RE.test(haystack)) return "targets the OpenBot database or vault";
  if (SUDO_RE.test(haystack)) return "invokes sudo";
  if (RM_RF_RE.test(haystack) && req.inWorkspace === false) {
    return "rm -rf outside the workspace";
  }
  return undefined;
}

/**
 * The other half of E6 ("ask" rules): sensitive computer targets, `sideEffect`
 * connector actions, and local-machine actions. Checked as builtin `ask`
 * `Rule`s so they participate in the same deny>ask>allow merge as user/preset
 * rules, but nothing outranks `ask` except an explicit `deny` — never `allow`.
 */
export function builtinAskRules(req: BrokerRequest): Rule[] {
  const now = new Date().toISOString();
  const rules: Rule[] = [];
  if (req.kind === "computer_action" && req.target && SENSITIVE_COMPUTER_TARGET_RE.test(req.target)) {
    rules.push(
      builtinRule("ask", `sensitive computer target: "${req.target}"`, { computerOp: "*" }, now),
    );
  }
  if (req.kind === "connector_action" && req.sideEffect) {
    rules.push(
      builtinRule("ask", `connector action "${req.action}" has a side effect`, {
        connectorAction: "*",
      }, now),
    );
  }
  if (req.kind === "local_computer") {
    rules.push(builtinRule("ask", "local-machine action (ask every time by default)", {}, now));
  }
  return rules;
}

function builtinRule(
  effect: RuleEffect,
  reason: string,
  match: Rule["match"],
  createdAt: string,
): Rule {
  // `_reason` is stashed for the broker's decision reason; not part of the
  // `Rule` contract, so callers that only care about `effect`/`match` are
  // unaffected — the extra field just rides along on the object.
  const rule: Rule & { _reason?: string } = {
    id: newId("rule"),
    scope: "global",
    match,
    effect,
    source: "builtin",
    createdAt,
    _reason: reason,
  };
  return rule;
}

/** Default rules derived from a Bot's `permissionPreset` (plan §4.1). Non-read actions are the only ones a preset opines on; reads are always allowed upstream of this. */
export function presetRules(preset: "read_only" | "workspace_write" | "full"): Rule[] {
  const now = new Date().toISOString();
  if (preset === "read_only") {
    return [builtinRule("deny", "read_only preset denies non-read actions", { tool: "*" }, now)].map(
      (r) => ({ ...r, source: "preset" as const }),
    );
  }
  // workspace_write / full: no blanket rule here — file-write scope is enforced
  // by the built-in deny pass (outside-workspace paths); computer/connector
  // risk still goes to the Jev gate below.
  return [];
}

/** A user-authored or CoS-authored rule (e.g. "always allow" from an approval card, or an explicit deny). */
export interface RuleStore {
  list(scope: string): Rule[];
  add(rule: Omit<Rule, "id" | "createdAt">): Rule;
}

export class InMemoryRuleStore implements RuleStore {
  private readonly rules: Rule[] = [];

  list(scope: string): Rule[] {
    return this.rules.filter((r) => r.scope === scope || r.scope === "global");
  }

  add(rule: Omit<Rule, "id" | "createdAt">): Rule {
    const full: Rule = { ...rule, id: newId("rule"), createdAt: new Date().toISOString() };
    this.rules.push(full);
    return full;
  }

  all(): Rule[] {
    return [...this.rules];
  }
}

/** `*` is the only wildcard: matches any run of characters. Everything else is literal. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesGlob(glob: string | undefined, value: string | undefined): boolean {
  if (glob === undefined) return false;
  if (value === undefined) return false;
  return globToRegExp(glob).test(value);
}

function matchesArgs(pattern: Record<string, unknown> | undefined, args: Record<string, unknown> | undefined): boolean {
  if (!pattern) return true;
  if (!args) return false;
  return Object.entries(pattern).every(([key, expected]) => args[key] === expected);
}

/** Does `rule` match `req`? Matches on the field appropriate to `req.kind` (tool/computerOp/connectorAction), plus an optional `args` sub-match. */
export function ruleMatches(rule: Rule, req: BrokerRequest): boolean {
  const fieldMatch =
    (req.kind === "tool" && matchesGlob(rule.match.tool, req.action)) ||
    (req.kind === "computer_action" && matchesGlob(rule.match.computerOp, req.action)) ||
    (req.kind === "connector_action" && matchesGlob(rule.match.connectorAction, req.action)) ||
    (req.kind === "local_computer" &&
      rule.match.tool === undefined &&
      rule.match.computerOp === undefined &&
      rule.match.connectorAction === undefined);
  if (!fieldMatch) return false;
  return matchesArgs(rule.match.args, req.args);
}

const SEVERITY: Record<RuleEffect, number> = { deny: 3, ask: 2, allow: 1 };

/** Merges every matching rule (regardless of source) and returns the single most severe outcome (deny > ask > allow), or `undefined` if nothing matched. */
export function resolveRules(
  rules: Rule[],
  req: BrokerRequest,
): { effect: RuleEffect; rule: Rule } | undefined {
  let best: { effect: RuleEffect; rule: Rule } | undefined;
  for (const rule of rules) {
    if (!ruleMatches(rule, req)) continue;
    if (!best || SEVERITY[rule.effect] > SEVERITY[best.effect]) {
      best = { effect: rule.effect, rule };
    }
  }
  return best;
}

/** Human-readable reason for a matched rule, using the stashed builtin reason when present. */
export function ruleReason(rule: Rule): string {
  const stashed = (rule as Rule & { _reason?: string })._reason;
  if (stashed) return stashed;
  if (rule.source === "preset") return `${rule.effect} by permission preset`;
  return `${rule.effect} by ${rule.source} rule matching ${JSON.stringify(rule.match)}`;
}
