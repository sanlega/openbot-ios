import type { MessageKind } from "@openbot/contracts";

export interface NotifyRequest {
  botId: string;
  chainId?: string;
  kind: MessageKind;
  body: string;
  options?: string[];
  deadline?: string;
  dedupeKey?: string;
}

export interface NotifyResult {
  delivery: "delivered" | "held" | "merged";
  pushed: boolean;
  notifyDecisionId?: string;
}

/**
 * WS8's gate for every bot-to-user message (plan §5 WS2: "Bot-to-user
 * delivery calls WS8's `NotifyGate` and never sends directly"; plan §4.4
 * `DecisionService`/§4.9 `message_user`). WS2 depends only on this port —
 * `packages/cos` (WS8) implements it for real (caps S4-S7/S10, the Jev notify
 * questions, dedupe, merge windows, quiet hours).
 */
export interface NotifyGate {
  notify(req: NotifyRequest): Promise<NotifyResult>;
}

/**
 * A stand-in `NotifyGate` for tests and for running the rest of WS2 before
 * WS8 lands: delivers everything, pushes only `blocker`s. **Not** the real
 * S4-S7/S10 policy — WS8's gate replaces this at integration time.
 */
export class PassthroughNotifyGate implements NotifyGate {
  async notify(req: NotifyRequest): Promise<NotifyResult> {
    return { delivery: "delivered", pushed: req.kind === "blocker" };
  }
}
