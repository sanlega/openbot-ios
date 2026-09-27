import type { Clock, OBEvent } from "@openbot/contracts";
import type { EventStore } from "@openbot/store";
import type { NdjsonWriter, NullNdjsonWriter } from "./ndjson-writer.js";

export type PublishInput = Omit<OBEvent, "id" | "seq" | "ts"> & { id?: string; ts?: string };

/**
 * The event bus (plan §4.2/§5 WS1): persist -> NDJSON -> fan-out, one write per
 * event. `publish()` awaits both durable steps (SQLite insert, NDJSON append)
 * before notifying subscribers, so a client that reacts to a live event can
 * always find it again via `replaySince()` — this is what makes WebSocket
 * reconnects gap-free (WS1 acceptance: "the WebSocket replay has no gaps").
 */
export class EventBus {
  private readonly subscribers = new Set<(event: OBEvent) => void>();

  constructor(
    private readonly store: EventStore,
    private readonly ndjson: NdjsonWriter | NullNdjsonWriter,
    private readonly clock: Clock,
  ) {}

  async publish(input: PublishInput): Promise<OBEvent> {
    const event = this.store.append({ ...input, ts: input.ts ?? this.clock.now().toISOString() });
    await this.ndjson.append(event);
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
    return event;
  }

  /** Returns an unsubscribe function. Subscribers are called synchronously, in publish order, after the event is durable. */
  subscribe(onEvent: (event: OBEvent) => void): () => void {
    this.subscribers.add(onEvent);
    return () => this.subscribers.delete(onEvent);
  }

  /** Replay from `since` (exclusive) — same semantics as `EventStore.listSince`, exposed here so callers only depend on `EventBus`. */
  replaySince(since: number): OBEvent[] {
    return this.store.listSince(since);
  }

  /** Cursor for a later {@link replaySince}: events are durable as soon as `publish()` is called. */
  latestSeq(): number {
    return this.store.latestSeq();
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}
