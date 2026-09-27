/**
 * A turn ends when the engine says so, not after a fixed wall-clock time: real
 * work runs for minutes. It only times out after this long with no output at
 * all, which is longer than an approval card lives (30 min), so a turn parked
 * on the user's answer is never cut off first.
 */
export const TURN_IDLE_TIMEOUT_MS = 35 * 60_000;

export interface WaitableTurnState {
  turnComplete: boolean;
  isError: boolean;
  errorMessage?: string;
}

export async function waitForTurnComplete(
  state: WaitableTurnState,
  interrupted: () => boolean,
  lastActivityAt: () => number,
  idleTimeoutMs = TURN_IDLE_TIMEOUT_MS,
): Promise<void> {
  while (!state.turnComplete && !interrupted()) {
    if (Date.now() - lastActivityAt() > idleTimeoutMs) {
      state.turnComplete = true;
      state.isError = true;
      state.errorMessage = "turn timed out (no engine output)";
      break;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}
