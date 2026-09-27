import { newId, type OBEvent } from "@openbot/contracts";

/**
 * The event bus's write side (plan §4.2/WS1: "persist -> NDJSON -> fan-out, one
 * transaction per event"). `packages/runtime` never touches the DB or NDJSON
 * directly — it only calls `emit()` and gets back the assigned `id`/`seq`.
 * `@openbot/store`'s `EventStore.append()` already has this exact shape, so
 * WS1's real bus is a drop-in implementation of this port.
 */
export interface EventSink {
  emit(event: Omit<OBEvent, "id" | "seq"> & { id?: string }): OBEvent;
}

/**
 * In-memory `EventSink` for tests: assigns a monotonic `seq` and keeps every
 * emitted event in order, with helpers to filter by type for assertions (e.g.
 * the dry-run leak test asserting on `action.simulated` events).
 */
export class InMemoryEventSink implements EventSink {
  private seq = 0;
  readonly events: OBEvent[] = [];

  emit(event: Omit<OBEvent, "id" | "seq"> & { id?: string }): OBEvent {
    const full: OBEvent = {
      id: event.id ?? newId("event"),
      seq: ++this.seq,
      ts: event.ts,
      type: event.type,
      botId: event.botId,
      threadId: event.threadId,
      turnId: event.turnId,
      chainId: event.chainId,
      payload: event.payload,
    };
    this.events.push(full);
    return full;
  }

  byType(type: OBEvent["type"]): OBEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  clear(): void {
    this.events.length = 0;
    this.seq = 0;
  }
}
