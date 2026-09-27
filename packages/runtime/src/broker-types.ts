export type BrokerActionKind = "tool" | "computer_action" | "connector_action" | "local_computer";

/**
 * A generic description of one action a Bot wants to take, independent of
 * which workstream originated it (WS4's tool handlers, WS9's fast loop, etc.).
 * The permission broker (plan §4.1 E6/§5 WS2) never needs to know about MCP,
 * Playwright, or connector servers directly — only this shape.
 */
export interface BrokerRequest {
  botId: string;
  chainId: string;
  kind: BrokerActionKind;
  /** Tool name (`kind: 'tool'`), computer op (`kind: 'computer_action'`), or connector action id (`kind: 'connector_action'`). */
  action: string;
  /** Free-form target for matching, e.g. a computer element's observed label, a file path, a connector app id. */
  target?: string;
  /** Set by the caller for connector actions (from `ConnectorProvider.toolMeta`). */
  sideEffect?: boolean;
  /** Set by the caller for computer actions: true for `observe`/`navigate`/`scroll`-class read-only ops. */
  readOnly?: boolean;
  /** Whether the action's target/effect stays inside the shared workspace directory. Defaults to `true` — callers must explicitly say `false` for known-outside-workspace actions. */
  inWorkspace?: boolean;
  args?: Record<string, unknown>;
  summary: string;
  detail: string;
}

export type BrokerOutcome = "allow" | "deny" | "ask" | "simulate";

export interface BrokerDecision {
  outcome: BrokerOutcome;
  reason: string;
  /** Present when `outcome === 'ask'`: the pending `Approval` id the caller must wait on. */
  approvalId?: string;
}
