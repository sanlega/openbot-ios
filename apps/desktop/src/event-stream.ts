import { EventEmitter } from "node:events";
import type { OBEvent } from "@openbot/contracts";
import { shouldPushNotification } from "./notify-filter.js";

export type EventStreamEvents = {
  notify: [event: OBEvent];
  event: [event: OBEvent];
  error: [error: Error];
};

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (ev: unknown) => void,
  ): void;
  removeEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (ev: unknown) => void,
  ): void;
}

export interface WebSocketFactory {
  create(url: string): WebSocketLike;
  readonly OPEN: number;
}

/** Subscribes to harness WebSocket events and surfaces push-worthy `notify.requested` events. */
export class HarnessEventStream extends EventEmitter<EventStreamEvents> {
  private ws?: WebSocketLike;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private readonly wsUrl: string,
    private readonly wsFactory: WebSocketFactory,
    private readonly reconnectDelayMs = 2000,
  ) {
    super();
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = undefined;
  }

  private connect(): void {
    this.ws = this.wsFactory.create(this.wsUrl);

    const onOpen = (): void => {
      this.ws?.send(JSON.stringify({ subscribe: true, since: 0 }));
    };

    const onMessage = (ev: unknown): void => {
      const message = ev as { data?: string };
      if (!message.data) return;
      try {
        const event = JSON.parse(message.data) as OBEvent;
        this.emit("event", event);
        if (shouldPushNotification(event)) this.emit("notify", event);
      } catch (err: unknown) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    };

    const onClose = (): void => {
      this.ws?.removeEventListener("open", onOpen);
      this.ws?.removeEventListener("message", onMessage);
      this.ws?.removeEventListener("close", onClose);
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelayMs);
      }
    };

    this.ws.addEventListener("open", onOpen);
    this.ws.addEventListener("message", onMessage);
    this.ws.addEventListener("close", onClose);
    this.ws.addEventListener("error", () => {
      // close handler schedules reconnect
    });
  }
}
