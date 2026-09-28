export type ConnectionState =
  | { status: "disconnected" }
  | { status: "connecting"; attempt: number }
  | { status: "connected"; since: number }
  | { status: "reconnecting"; attempt: number }
  | { status: "suspended" }
  | { status: "revoked" };

export function reconnectDelay(attempt: number): number {
  const boundedAttempt = Math.max(0, Math.min(Math.floor(attempt), 7));
  return Math.min(30_000, 500 * 2 ** boundedAttempt);
}

/** Advances a durable cursor only after every earlier event has arrived. */
export function advanceEventCursor(cursor: number, pending: Set<number>, sequence: number): number {
  if (sequence > cursor) pending.add(sequence);
  while (pending.delete(cursor + 1)) cursor += 1;
  return cursor;
}

export function connectionLabel(state: ConnectionState): string {
  switch (state.status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "revoked":
      return "Pairing revoked";
    case "suspended":
      return "Paused in background";
    case "disconnected":
      return "Desktop offline";
  }
}
