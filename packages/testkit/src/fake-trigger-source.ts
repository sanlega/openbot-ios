import { createHash } from "node:crypto";
import type { TriggerSource, TriggerSourceEvent } from "@openbot/contracts";
import type { Clock } from "@openbot/contracts";

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Scriptable `TriggerSource` (plan §5 WS0 fakes list) for WS12's routine-run
 * tests: call `push(payload)` to synthesize an inbound trigger event, with no
 * real webhook/connector/file-watch behind it.
 */
export class FakeTriggerSource implements TriggerSource {
  readonly id: string;
  private listener?: (e: TriggerSourceEvent) => void;
  private started = false;
  private seq = 0;
  private readonly clock: Clock;

  constructor(id = "fake", clock: Clock = { now: () => new Date() }) {
    this.id = id;
    this.clock = clock;
  }

  async start(onEvent: (e: TriggerSourceEvent) => void): Promise<void> {
    this.listener = onEvent;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.listener = undefined;
  }

  /** Synthesizes an event as if it had arrived from a real source; no-op (returns undefined) before `start()`. */
  push(payload: unknown): TriggerSourceEvent | undefined {
    if (!this.started || !this.listener) return undefined;
    const event: TriggerSourceEvent = {
      id: `${this.id}_${++this.seq}`,
      source: this.id,
      payloadHash: hashPayload(payload),
      payload,
      receivedAt: this.clock.now().toISOString(),
    };
    this.listener(event);
    return event;
  }

  get isStarted(): boolean {
    return this.started;
  }
}
