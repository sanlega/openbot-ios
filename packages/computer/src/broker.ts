import type { Action, Observation } from "@openbot/contracts";

export type BrokerDecision = "allow" | "ask" | "deny";

/** Minimal broker hook WS9 uses until WS2's full permission broker lands. */
export interface ComputerActionBroker {
  checkAction(input: {
    botId: string;
    chainId: string;
    action: Action;
    observation: Observation;
    providerId: string;
    isDestructive?: boolean;
    sensitiveLabel?: boolean;
  }): Promise<BrokerDecision>;
}

/** Default broker: allow observe/navigate/scroll/wait; ask on destructive/sensitive/local. */
export class DefaultComputerActionBroker implements ComputerActionBroker {
  constructor(private readonly alwaysAskProviders: Set<string> = new Set(["local"])) {}

  async checkAction(input: {
    action: Action;
    providerId: string;
    isDestructive?: boolean;
    sensitiveLabel?: boolean;
  }): Promise<BrokerDecision> {
    const { action, providerId, isDestructive, sensitiveLabel } = input;
    if (action.op === "navigate" || action.op === "scroll") {
      return "allow";
    }
    if (action.op === "wait" || action.op === "done") return "allow";
    if (this.alwaysAskProviders.has(providerId)) return "ask";
    if (isDestructive || sensitiveLabel) return "ask";
    return "allow";
  }
}
