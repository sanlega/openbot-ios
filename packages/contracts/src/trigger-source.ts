/** One interface behind every routine trigger source (plan §5 WS12): connector triggers, webhooks, file watch, OpenBot events. */
export interface TriggerSourceEvent {
  id: string;
  source: string;
  payloadHash: string;
  payload: unknown;
  receivedAt: string;
}

export interface TriggerSource {
  id: string;
  start(onEvent: (e: TriggerSourceEvent) => void): Promise<void>;
  stop(): Promise<void>;
}

/** A controllable clock so scheduler/cap-window tests (WS7 CapCounter, WS12 croner scheduling) are deterministic. */
export interface Clock {
  now(): Date;
  /** Advances the fake clock and fires any timers scheduled up to the new time. Real clocks ignore this. */
  advance?(ms: number): void;
}

export function systemClock(): Clock {
  return { now: () => new Date() };
}
