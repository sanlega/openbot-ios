/**
 * Pure display logic for the WS0 acceptance criterion ("the desktop shell
 * shows 'harness connected'"), kept separate from `main.ts`/`preload.ts` so
 * it's testable with plain Vitest — no Electron runtime or display required.
 */
export interface HarnessStatus {
  connected: boolean;
  version?: string;
}

export function formatHarnessStatus(status: HarnessStatus): string {
  if (!status.connected) return "Harness disconnected";
  return status.version ? `Harness connected (v${status.version})` : "Harness connected";
}

/** Fetches `GET /api/harness/status` from `apps/server` and formats it, with a friendly message on any network failure. */
export async function fetchHarnessStatus(baseUrl: string): Promise<string> {
  try {
    const res = await fetch(`${baseUrl}/api/harness/status`);
    if (!res.ok) return "Harness disconnected";
    const body = (await res.json()) as HarnessStatus;
    return formatHarnessStatus(body);
  } catch {
    return "Harness disconnected";
  }
}
